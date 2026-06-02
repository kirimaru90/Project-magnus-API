import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { StateEntry } from '../campaigns/schemas/campaign.schema';
import {
  Campaign,
  CampaignDocument,
} from '../campaigns/schemas/campaign.schema';
import {
  Terminal,
  TerminalDocument,
} from '../terminals/schemas/terminal.schema';
import { MutationItemDto } from './dto/mutation.dto';
import { EntryShapeDto, StateSchemaOpDto } from './dto/schema-patch.dto';

type Scope = 'local' | 'global';

interface MutationPlanItem {
  fieldPath: string;
  op: 'set' | 'increment' | 'toggle';
  value?: unknown;
  by?: number;
}

function stateToFlat(
  state: Map<string, StateEntry> | Record<string, StateEntry>,
) {
  const entries =
    state instanceof Map ? state.entries() : Object.entries(state);
  const result: Record<string, unknown> = {};
  for (const [k, v] of entries) result[k] = v.value;
  return result;
}

function validateType(
  entry: StateEntry,
  op: MutationItemDto['op'],
  value: unknown,
) {
  if (op === 'increment') {
    if (entry.type !== 'number')
      throw new BadRequestException(`increment requires type:number for key`);
  } else if (op === 'toggle') {
    if (entry.type !== 'boolean')
      throw new BadRequestException(`toggle requires type:boolean for key`);
  } else if (op === 'set') {
    if (entry.type === 'boolean' && typeof value !== 'boolean') {
      throw new BadRequestException(`set value must be boolean`);
    } else if (entry.type === 'number' && typeof value !== 'number') {
      throw new BadRequestException(`set value must be number`);
    } else if (entry.type === 'enum') {
      if (!(entry.values ?? []).includes(value as string)) {
        throw new BadRequestException(
          `set value must be one of: ${(entry.values ?? []).join(', ')}`,
        );
      }
    } else if (entry.type === 'string' && typeof value !== 'string') {
      throw new BadRequestException(`set value must be string`);
    }
  }
}

function validateEntryShape(entry: EntryShapeDto) {
  if (entry.type === 'enum') {
    if (!Array.isArray(entry.values) || entry.values.length === 0) {
      throw new BadRequestException(
        'entry.values must be a non-empty string[] when type is "enum"',
      );
    }
    if (!entry.values.includes(entry.default as string)) {
      throw new BadRequestException(
        `entry.default must be one of: ${entry.values.join(', ')}`,
      );
    }
  } else {
    const typeMap: Record<string, string> = {
      boolean: 'boolean',
      number: 'number',
      string: 'string',
    };
    if (typeof entry.default !== typeMap[entry.type]) {
      throw new BadRequestException(
        `entry.default must be ${entry.type}, got ${typeof entry.default}`,
      );
    }
  }
}

function validateValueAgainstType(entry: EntryShapeDto, value: unknown) {
  if (entry.type === 'boolean' && typeof value !== 'boolean') {
    throw new BadRequestException(`value must be boolean`);
  } else if (entry.type === 'number' && typeof value !== 'number') {
    throw new BadRequestException(`value must be number`);
  } else if (entry.type === 'string' && typeof value !== 'string') {
    throw new BadRequestException(`value must be string`);
  } else if (entry.type === 'enum') {
    if (!(entry.values ?? []).includes(value as string)) {
      throw new BadRequestException(
        `value must be one of: ${(entry.values ?? []).join(', ')}`,
      );
    }
  }
}

function checkOpNameUniqueness(ops: StateSchemaOpDto[]) {
  const seen = new Set<string>();
  for (const op of ops) {
    if (seen.has(op.name)) {
      throw new BadRequestException(
        `Variable name "${op.name}" appears in more than one op`,
      );
    }
    seen.add(op.name);
    if ('rename' in op && op.rename) {
      if (seen.has(op.rename)) {
        throw new BadRequestException(
          `Variable name "${op.rename}" appears in more than one op`,
        );
      }
      seen.add(op.rename);
    }
  }
}

function projectSchemaOps(
  stateMap: Record<string, StateEntry>,
  ops: StateSchemaOpDto[],
): Record<string, StateEntry> {
  const newMap: Record<string, StateEntry> = { ...stateMap };

  for (const op of ops) {
    if (op.action === 'add') {
      if (newMap[op.name] !== undefined) {
        throw new BadRequestException(
          `Variable "${op.name}" already exists; use action "update" to modify`,
        );
      }
      validateEntryShape(op.entry!);
      const resolvedValue =
        op.value !== undefined ? op.value : op.entry!.default;
      validateValueAgainstType(op.entry!, resolvedValue);
      newMap[op.name] = {
        type: op.entry!.type,
        default: op.entry!.default,
        value: resolvedValue,
        ...(op.entry!.values ? { values: op.entry!.values } : {}),
      };
    } else if (op.action === 'update') {
      if (newMap[op.name] === undefined) {
        throw new NotFoundException(`Variable "${op.name}" not found`);
      }
      validateEntryShape(op.entry!);
      const resolvedValue =
        op.value !== undefined ? op.value : op.entry!.default;
      validateValueAgainstType(op.entry!, resolvedValue);
      const updatedEntry: StateEntry = {
        type: op.entry!.type,
        default: op.entry!.default,
        value: resolvedValue,
        ...(op.entry!.values ? { values: op.entry!.values } : {}),
      };
      if (op.rename) {
        if (newMap[op.rename] !== undefined) {
          throw new ConflictException(
            `Rename target "${op.rename}" already exists in state`,
          );
        }
        delete newMap[op.name];
        newMap[op.rename] = updatedEntry;
      } else {
        newMap[op.name] = updatedEntry;
      }
    } else if (op.action === 'delete') {
      if (newMap[op.name] === undefined) {
        throw new NotFoundException(`Variable "${op.name}" not found`);
      }
      delete newMap[op.name];
    }
  }

  return newMap;
}

@Injectable()
export class StateService {
  constructor(
    @InjectModel(Campaign.name) private campaignModel: Model<CampaignDocument>,
    @InjectModel(Terminal.name) private terminalModel: Model<TerminalDocument>,
  ) {}

  private parseMutations(
    stateMap: Map<string, StateEntry> | Record<string, StateEntry>,
    mutations: MutationItemDto[],
    expectedScope: Scope,
  ): MutationPlanItem[] {
    const getEntry = (key: string): StateEntry | undefined =>
      stateMap instanceof Map ? stateMap.get(key) : stateMap[key];

    // Validate scope homogeneity
    for (const m of mutations) {
      const [scope, varName] = m.key.split('.') as [string, string];
      if (scope !== expectedScope) {
        throw new BadRequestException(
          `All mutations must use scope "${expectedScope}". Got "${scope}" in key "${m.key}"`,
        );
      }
      if (!varName)
        throw new BadRequestException(`Invalid key format: ${m.key}`);

      const entry = getEntry(varName);
      if (!entry)
        throw new BadRequestException(`Undeclared variable: ${varName}`);
      validateType(entry, m.op, m.value);
    }

    return mutations.map((m) => {
      const varName = m.key.split('.')[1];
      return {
        fieldPath: `state.${varName}.value`,
        op: m.op,
        value: m.value,
        by: m.by,
      };
    });
  }

  private buildMongoUpdate(plan: MutationPlanItem[]) {
    const $set: Record<string, unknown> = {};
    const $inc: Record<string, number> = {};

    for (const item of plan) {
      if (item.op === 'set') {
        $set[item.fieldPath] = item.value;
      } else if (item.op === 'increment') {
        $inc[item.fieldPath] = item.by ?? 1;
      } else if (item.op === 'toggle') {
        // toggle requires a separate read-then-write; we handle via $set after reading
      }
    }

    return { $set, $inc };
  }

  // --- Terminal (local) state ---

  async getTerminalState(terminalId: string) {
    const terminal = await this.terminalModel.findById(terminalId).lean();
    return stateToFlat(terminal!.state);
  }

  async mutateTerminalState(terminalId: string, mutations: MutationItemDto[]) {
    const terminal = await this.terminalModel.findById(terminalId).lean();
    if (!terminal) throw new BadRequestException('Terminal not found');

    const stateMap = terminal.state as unknown as Record<string, StateEntry>;
    const plan = this.parseMutations(stateMap, mutations, 'local');

    // Handle toggle by computing new values from current state
    const $set: Record<string, unknown> = {};
    const $inc: Record<string, number> = {};

    for (const item of plan) {
      if (item.op === 'set') {
        $set[item.fieldPath] = item.value;
      } else if (item.op === 'increment') {
        $inc[item.fieldPath] = item.by ?? 1;
      } else if (item.op === 'toggle') {
        const varName = item.fieldPath
          .replace('state.', '')
          .replace('.value', '');
        const current = stateMap[varName].value;
        $set[item.fieldPath] = !current;
      }
    }

    const updateOp: Record<string, unknown> = {};
    if (Object.keys($set).length > 0) updateOp['$set'] = $set;
    if (Object.keys($inc).length > 0) updateOp['$inc'] = $inc;

    const updated = await this.terminalModel
      .findByIdAndUpdate(terminalId, updateOp, { new: true })
      .lean();

    return {
      state: stateToFlat(updated!.state),
    };
  }

  async resetTerminalState(terminalId: string) {
    const terminal = await this.terminalModel.findById(terminalId).lean();
    if (!terminal) throw new BadRequestException('Terminal not found');

    const stateMap = terminal.state as unknown as Record<string, StateEntry>;
    const $set: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(stateMap)) {
      $set[`state.${key}.value`] = entry.default;
    }

    const updated = await this.terminalModel
      .findByIdAndUpdate(terminalId, { $set }, { new: true })
      .lean();

    return {
      state: stateToFlat(updated!.state),
    };
  }

  async resetTerminalStateKey(terminalId: string, key: string) {
    const terminal = await this.terminalModel.findById(terminalId).lean();
    if (!terminal) throw new BadRequestException('Terminal not found');

    const stateMap = terminal.state as unknown as Record<string, StateEntry>;
    const entry = stateMap[key];
    if (!entry) throw new BadRequestException(`Undeclared variable: ${key}`);

    const updated = await this.terminalModel
      .findByIdAndUpdate(
        terminalId,
        { $set: { [`state.${key}.value`]: entry.default } },
        { new: true },
      )
      .lean();

    return {
      state: stateToFlat(updated!.state),
    };
  }

  // --- Campaign (global) state ---

  async getCampaignState(campaignId: string) {
    const campaign = await this.campaignModel.findById(campaignId).lean();
    return stateToFlat(campaign!.state);
  }

  async mutateCampaignState(campaignId: string, mutations: MutationItemDto[]) {
    const campaign = await this.campaignModel.findById(campaignId).lean();
    if (!campaign) throw new BadRequestException('Campaign not found');

    const stateMap = campaign.state as unknown as Record<string, StateEntry>;
    const plan = this.parseMutations(stateMap, mutations, 'global');

    const $set: Record<string, unknown> = {};
    const $inc: Record<string, number> = {};

    for (const item of plan) {
      if (item.op === 'set') {
        $set[item.fieldPath] = item.value;
      } else if (item.op === 'increment') {
        $inc[item.fieldPath] = item.by ?? 1;
      } else if (item.op === 'toggle') {
        const varName = item.fieldPath
          .replace('state.', '')
          .replace('.value', '');
        const current = stateMap[varName].value;
        $set[item.fieldPath] = !current;
      }
    }

    const updateOp: Record<string, unknown> = {};
    if (Object.keys($set).length > 0) updateOp['$set'] = $set;
    if (Object.keys($inc).length > 0) updateOp['$inc'] = $inc;

    const updated = await this.campaignModel
      .findByIdAndUpdate(campaignId, updateOp, { new: true })
      .lean();

    return {
      state: stateToFlat(updated!.state),
    };
  }

  async resetCampaignState(campaignId: string) {
    const campaign = await this.campaignModel.findById(campaignId).lean();
    if (!campaign) throw new BadRequestException('Campaign not found');

    const stateMap = campaign.state as unknown as Record<string, StateEntry>;
    const $set: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(stateMap)) {
      $set[`state.${key}.value`] = entry.default;
    }

    await this.campaignModel.findByIdAndUpdate(campaignId, { $set });

    // Also reset all terminals in this campaign
    const terminals = await this.terminalModel
      .find({ campaignId: new Types.ObjectId(campaignId) })
      .lean();
    for (const terminal of terminals) {
      const termState = terminal.state as unknown as Record<string, StateEntry>;
      const tSet: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(termState)) {
        tSet[`state.${key}.value`] = entry.default;
      }
      if (Object.keys(tSet).length > 0) {
        await this.terminalModel.findByIdAndUpdate(terminal._id, {
          $set: tSet,
        });
      }
    }

    const updated = await this.campaignModel.findById(campaignId).lean();
    return {
      state: stateToFlat(updated!.state),
    };
  }

  async resetCampaignStateKey(campaignId: string, key: string) {
    const campaign = await this.campaignModel.findById(campaignId).lean();
    if (!campaign) throw new BadRequestException('Campaign not found');

    const stateMap = campaign.state as unknown as Record<string, StateEntry>;
    const entry = stateMap[key];
    if (!entry) throw new BadRequestException(`Undeclared variable: ${key}`);

    const updated = await this.campaignModel
      .findByIdAndUpdate(
        campaignId,
        { $set: { [`state.${key}.value`]: entry.default } },
        { new: true },
      )
      .lean();

    return {
      state: stateToFlat(updated!.state),
    };
  }

  // --- Schema-admin: terminal (local) ---

  async patchTerminalSchema(terminalId: string, ops: StateSchemaOpDto[]) {
    if (!ops || ops.length === 0) {
      throw new BadRequestException('ops must be a non-empty array');
    }

    checkOpNameUniqueness(ops);

    const terminal = await this.terminalModel.findById(terminalId).lean();
    if (!terminal) throw new NotFoundException('Terminal not found');

    const stateMap = terminal.state as unknown as Record<string, StateEntry>;
    const newMap = projectSchemaOps(stateMap, ops);

    const updated = await this.terminalModel
      .findByIdAndUpdate(terminalId, { $set: { state: newMap } }, { new: true })
      .lean();

    return { state: stateToFlat(updated!.state) };
  }

  // --- Schema-admin: campaign (global) ---

  async patchCampaignSchema(campaignId: string, ops: StateSchemaOpDto[]) {
    if (!ops || ops.length === 0) {
      throw new BadRequestException('ops must be a non-empty array');
    }

    checkOpNameUniqueness(ops);

    const campaign = await this.campaignModel.findById(campaignId).lean();
    if (!campaign) throw new NotFoundException('Campaign not found');

    const stateMap = campaign.state as unknown as Record<string, StateEntry>;

    // Project ops in-memory first (validates 400/404/409 before any DB write)
    const newMap = projectSchemaOps(stateMap, ops);

    // Cross-reference scan: needed for delete ops and rename ops
    const deleteOps = ops.filter((o) => o.action === 'delete');
    const renameOps = ops.filter((o) => o.action === 'update' && o.rename);

    if (deleteOps.length > 0 || renameOps.length > 0) {
      type TerminalRef = {
        _id: Types.ObjectId;
        title: string;
        content: Record<string, unknown>;
      };
      const terminals = (await this.terminalModel
        .find(
          { campaignId: new Types.ObjectId(campaignId) },
          { _id: 1, title: 1, 'content.state.global': 1 },
        )
        .lean()) as TerminalRef[];

      const getGlobal = (t: (typeof terminals)[number]) => {
        const s = (t.content as Record<string, Record<string, unknown>>)?.state;
        return s?.global as Record<string, unknown> | undefined;
      };

      // Check delete cross-refs
      const deleteConflicts: Array<{
        variable: string;
        referencedBy: Array<{ id: string; title: string }>;
      }> = [];
      for (const op of deleteOps) {
        const refs = terminals.filter(
          (t) => getGlobal(t)?.[op.name] !== undefined,
        );
        if (refs.length > 0) {
          deleteConflicts.push({
            variable: op.name,
            referencedBy: refs.map((t) => ({
              id: String(t._id),
              title: t.title,
            })),
          });
        }
      }
      if (deleteConflicts.length > 0) {
        throw new ConflictException({
          error: 'Cannot delete referenced variables',
          conflicts: deleteConflicts,
        });
      }

      // Check rename collision cross-refs
      const renameConflicts: Array<{
        variable: string;
        referencedBy: Array<{ id: string; title: string }>;
      }> = [];
      for (const op of renameOps) {
        const from = op.name;
        const to = op.rename!;
        const colliding = terminals.filter((t) => {
          const g = getGlobal(t);
          return g?.[from] !== undefined && g?.[to] !== undefined;
        });
        if (colliding.length > 0) {
          renameConflicts.push({
            variable: `${from} → ${to}`,
            referencedBy: colliding.map((t) => ({
              id: String(t._id),
              title: t.title,
            })),
          });
        }
      }
      if (renameConflicts.length > 0) {
        throw new ConflictException({
          error: 'Rename target already exists on referencing terminals',
          conflicts: renameConflicts,
        });
      }

      // Apply renames on terminals BEFORE campaign write (terminals first, campaign last)
      for (const op of renameOps) {
        const from = `content.state.global.${op.name}`;
        const to = `content.state.global.${op.rename}`;
        await this.terminalModel.updateMany(
          {
            campaignId: new Types.ObjectId(campaignId),
            [from]: { $exists: true },
          },
          { $rename: { [from]: to } },
        );
      }
    }

    const updated = await this.campaignModel
      .findByIdAndUpdate(campaignId, { $set: { state: newMap } }, { new: true })
      .lean();

    return { state: stateToFlat(updated!.state) };
  }
}
