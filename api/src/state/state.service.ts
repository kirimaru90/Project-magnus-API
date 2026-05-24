import { BadRequestException, Injectable } from '@nestjs/common';
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
}
