import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model, Types } from 'mongoose';
import { Terminal, TerminalDocument } from './schemas/terminal.schema';
import {
  FictionalUser,
  FictionalUserDocument,
} from './schemas/fictional-user.schema';
import {
  Campaign,
  CampaignDocument,
} from '../campaigns/schemas/campaign.schema';
import { StateEntry } from '../campaigns/schemas/campaign.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { TerminalContentDto, StateVarDto } from './dto/terminal-content.dto';
import { AuthenticatedUser } from '../auth/jwt.strategy';

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as Record<string, unknown>).code === 11000
  );
}

function buildStateEntry(decl: StateVarDto): StateEntry {
  return {
    type: decl.type,
    value: decl.default ?? null,
    default: decl.default ?? null,
    ...(decl.values ? { values: decl.values } : {}),
  };
}

function stateToFlat(state: Record<string, StateEntry>) {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(state)) result[k] = v.value;
  return result;
}

function stripContent(
  content: Record<string, unknown>,
): Record<string, unknown> {
  const stripped = { ...content };
  if (stripped.login && typeof stripped.login === 'object') {
    const users = (stripped.login as Record<string, unknown>).users;
    if (!Array.isArray(users) || users.length === 0) {
      delete stripped.login;
    }
    // else: users already contain only {username}, no password — pass through as-is
  }
  return stripped;
}

function withInjectedMetaId(
  content: Record<string, unknown>,
  id: unknown,
): Record<string, unknown> {
  const meta = {
    ...((content.meta as Record<string, unknown> | undefined) ?? {}),
  };
  if (meta.hiddenId === null) delete meta.hiddenId;
  meta.id = String(id);
  return { ...content, meta };
}

@Injectable()
export class TerminalsService {
  constructor(
    @InjectModel(Terminal.name) private terminalModel: Model<TerminalDocument>,
    @InjectModel(FictionalUser.name)
    private fictionalUserModel: Model<FictionalUserDocument>,
    @InjectModel(Campaign.name) private campaignModel: Model<CampaignDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Decide whether a playback load should increment viewCount.
   * Player and anonymous loads always count; admin loads count only when
   * the `terminals.countAdminViews` flag is enabled.
   */
  private shouldCountView(actor?: AuthenticatedUser): boolean {
    if (actor?.role === 'admin') {
      return (
        this.configService.get<boolean>('terminals.countAdminViews') === true
      );
    }
    return true;
  }

  private async incrementViewCount(id: Types.ObjectId | string): Promise<void> {
    await this.terminalModel.updateOne({ _id: id }, { $inc: { viewCount: 1 } });
  }

  private async projectState(
    campaignId: Types.ObjectId,
    dto: TerminalContentDto,
  ) {
    const localState: Record<string, StateEntry> = {};
    for (const [key, decl] of Object.entries(dto.state?.local ?? {})) {
      localState[key] = buildStateEntry(decl);
    }

    // Global state: first-declaration-wins
    if (dto.state?.global && Object.keys(dto.state.global).length > 0) {
      const campaign = await this.campaignModel.findById(campaignId).lean();
      if (!campaign) throw new NotFoundException('Campaign not found');

      const existingGlobal = campaign.state as unknown as Record<
        string,
        StateEntry
      >;
      const globalUpdates: Record<string, StateEntry> = {};

      for (const [key, decl] of Object.entries(dto.state.global)) {
        if (!existingGlobal[key]) {
          globalUpdates[`state.${key}`] = buildStateEntry(decl);
        }
      }

      if (Object.keys(globalUpdates).length > 0) {
        await this.campaignModel.findByIdAndUpdate(campaignId, {
          $set: globalUpdates,
        });
      }
    }

    return localState;
  }

  private validateNodeGraph(nodes: Record<string, unknown>): void {
    const targets: string[] = [];
    for (const node of Object.values(nodes)) {
      if (!node || typeof node !== 'object') continue;
      const n = node as Record<string, unknown>;
      for (const choice of (n.choices as Array<Record<string, unknown>>) ??
        []) {
        if (typeof choice?.target === 'string') targets.push(choice.target);
      }
      for (const variant of (n.variants as Array<Record<string, unknown>>) ??
        []) {
        for (const choice of (variant?.choices as Array<
          Record<string, unknown>
        >) ?? []) {
          if (typeof choice?.target === 'string') targets.push(choice.target);
        }
      }
    }
    const dangling = [...new Set(targets)].filter((t) => !(t in nodes));
    if (dangling.length > 0) {
      throw new BadRequestException(
        `nodes contains dangling choice targets: ${dangling.join(', ')}`,
      );
    }
  }

  private contentWithoutUsers(
    dto: TerminalContentDto,
  ): Record<string, unknown> {
    const content: Record<string, unknown> = {
      meta: dto.meta,
      state: dto.state ?? {},
      nodes: dto.nodes,
    };
    if (dto.login?.users?.length) {
      content.login = {
        users: dto.login.users.map((u) => ({ username: u.username })),
      };
    }
    return content;
  }

  async create(campaignId: string, dto: TerminalContentDto) {
    if (!Types.ObjectId.isValid(campaignId)) throw new NotFoundException();
    this.validateNodeGraph(dto.nodes);
    const campId = new Types.ObjectId(campaignId);
    const localState = await this.projectState(campId, dto);

    let terminal;
    try {
      terminal = await this.terminalModel.create({
        campaignId: campId,
        title: dto.meta.title,
        content: this.contentWithoutUsers(dto),
        state: localState,
      });
    } catch (error) {
      if (isDuplicateKeyError(error))
        throw new ConflictException(
          `hiddenId "${dto.meta.hiddenId}" already exists in this campaign`,
        );
      throw error;
    }

    // Persist fictional users
    if (dto.login?.users?.length) {
      await this.fictionalUserModel.deleteMany({ terminalId: terminal._id });
      await this.fictionalUserModel.insertMany(
        dto.login.users.map((u) => ({
          terminalId: terminal._id,
          username: u.username,
          password: u.password,
        })),
      );
    }

    return this.toSummary(terminal.toObject());
  }

  async update(id: string, dto: TerminalContentDto) {
    this.validateNodeGraph(dto.nodes);
    const existing = await this.terminalModel.findById(id).lean();
    if (!existing) throw new NotFoundException();

    const campId = existing.campaignId;

    // Additive state projection: merge new declarations without removing existing keys
    const existingState = existing.state as unknown as Record<
      string,
      StateEntry
    >;
    const newLocalDecls = dto.state?.local ?? {};
    const $set: Record<string, unknown> = {
      title: dto.meta.title,
      content: this.contentWithoutUsers(dto),
    };

    // Add new variables, keep existing ones untouched
    for (const [key, decl] of Object.entries(newLocalDecls)) {
      if (!existingState[key]) {
        $set[`state.${key}`] = buildStateEntry(decl);
      }
    }

    // Handle global state (first-declaration-wins still applies)
    if (dto.state?.global) {
      const campaign = await this.campaignModel.findById(campId).lean();
      const existingGlobal =
        (campaign?.state as unknown as Record<string, StateEntry>) ?? {};
      const globalUpdates: Record<string, StateEntry> = {};
      for (const [key, decl] of Object.entries(dto.state.global)) {
        if (!existingGlobal[key]) {
          globalUpdates[`state.${key}`] = buildStateEntry(decl);
        }
      }
      if (Object.keys(globalUpdates).length > 0) {
        await this.campaignModel.findByIdAndUpdate(campId, {
          $set: globalUpdates,
        });
      }
    }

    let updated;
    try {
      updated = await this.terminalModel
        .findByIdAndUpdate(id, { $set }, { new: true })
        .lean();
    } catch (error) {
      if (isDuplicateKeyError(error))
        throw new ConflictException(
          `hiddenId "${dto.meta.hiddenId}" already exists in this campaign`,
        );
      throw error;
    }

    // Replace fictional users
    await this.fictionalUserModel.deleteMany({ terminalId: existing._id });
    if (dto.login?.users?.length) {
      await this.fictionalUserModel.insertMany(
        dto.login.users.map((u) => ({
          terminalId: existing._id,
          username: u.username,
          password: u.password,
        })),
      );
    }

    if (!updated) throw new NotFoundException();
    return this.toSummary(updated);
  }

  async delete(id: string) {
    const terminal = await this.terminalModel.findByIdAndDelete(id).lean();
    if (!terminal) throw new NotFoundException();
    await this.fictionalUserModel.deleteMany({ terminalId: terminal._id });
    const hiddenId = (
      terminal.content?.meta as Record<string, unknown> | undefined
    )?.hiddenId;
    if (typeof hiddenId === 'string' && hiddenId) {
      const campaignId = String(terminal.campaignId);
      await this.userModel.updateMany(
        {},
        { $pull: { [`unlockedHiddenIds.${campaignId}`]: hiddenId } },
      );
    }
  }

  async listByCampaign(campaignId: string, actor?: AuthenticatedUser) {
    const terminals = await this.terminalModel
      .find({ campaignId: new Types.ObjectId(campaignId) })
      .lean();

    if (actor?.role === 'admin') {
      return terminals.map((t) => this.toSummary(t));
    }

    let unlockedSet = new Set<string>();
    if (actor?.role === 'player') {
      const userDoc = await this.userModel
        .findById(actor.id)
        .select('unlockedHiddenIds')
        .lean();
      if (userDoc) {
        const unlocks: string[] =
          userDoc.unlockedHiddenIds instanceof Map
            ? (userDoc.unlockedHiddenIds.get(campaignId) ?? [])
            : ((
                userDoc.unlockedHiddenIds as unknown as Record<string, string[]>
              )?.[campaignId] ?? []);
        unlockedSet = new Set(unlocks);
      }
    }

    return terminals
      .filter((t) => {
        const meta = t.content?.meta as Record<string, unknown> | undefined;
        if (meta?.public === true) return true;
        const hiddenId = meta?.hiddenId;
        return typeof hiddenId === 'string' && unlockedSet.has(hiddenId);
      })
      .map((t) => this.toSummary(t));
  }

  async detail(id: string, actor?: AuthenticatedUser) {
    const terminal = await this.terminalModel.findById(id).lean();
    if (!terminal) throw new NotFoundException();

    const base = {
      id: String(terminal._id),
      campaignId: String(terminal.campaignId),
      title: terminal.title,
      content: withInjectedMetaId(stripContent(terminal.content), terminal._id),
      state: stateToFlat(
        terminal.state as unknown as Record<string, StateEntry>,
      ),
      createdAt: terminal.createdAt,
      updatedAt: terminal.updatedAt,
    };

    if (actor?.role === 'admin') {
      const fictionalUsers = await this.fictionalUserModel
        .find({ terminalId: terminal._id })
        .lean();
      return {
        ...base,
        fictionalUsers: fictionalUsers.map((u) => ({
          username: u.username,
          password: u.password,
        })),
      };
    }

    return base;
  }

  async load(id: string, actor?: AuthenticatedUser) {
    const terminal = await this.terminalModel.findById(id).lean();
    if (!terminal) throw new NotFoundException();

    const campaign = await this.campaignModel
      .findById(terminal.campaignId)
      .lean();
    if (!campaign) throw new NotFoundException();

    if (this.shouldCountView(actor))
      await this.incrementViewCount(terminal._id);

    if (actor) {
      await this.userModel.updateOne(
        { _id: actor.id },
        { $set: { lastCampaignId: String(terminal.campaignId) } },
      );
    }

    return {
      content: withInjectedMetaId(stripContent(terminal.content), terminal._id),
      localState: stateToFlat(
        terminal.state as unknown as Record<string, StateEntry>,
      ),
      globalState: stateToFlat(
        campaign.state as unknown as Record<string, StateEntry>,
      ),
    };
  }

  async loadByHiddenId(
    campaignId: string,
    hiddenId: string,
    actor?: AuthenticatedUser,
  ) {
    if (!Types.ObjectId.isValid(campaignId)) throw new NotFoundException();
    const terminal = await this.terminalModel
      .findOne({
        campaignId: new Types.ObjectId(campaignId),
        'content.meta.hiddenId': hiddenId,
        'content.meta.public': { $ne: true },
      })
      .lean();

    if (!terminal) {
      // Self-heal: remove stale unlock entry for authenticated callers
      if (actor) {
        await this.userModel.updateOne(
          { _id: actor.id },
          { $pull: { [`unlockedHiddenIds.${campaignId}`]: hiddenId } },
        );
      }
      throw new NotFoundException();
    }

    const campaign = await this.campaignModel
      .findById(terminal.campaignId)
      .lean();
    if (!campaign) throw new NotFoundException();

    if (this.shouldCountView(actor))
      await this.incrementViewCount(terminal._id);

    // Write side-effects on success
    if (actor) {
      await this.userModel.updateOne(
        { _id: actor.id },
        { $set: { lastCampaignId: campaignId } },
      );
      if (actor.role === 'player') {
        await this.userModel.updateOne(
          { _id: actor.id },
          { $addToSet: { [`unlockedHiddenIds.${campaignId}`]: hiddenId } },
        );
      }
    }

    return {
      content: withInjectedMetaId(stripContent(terminal.content), terminal._id),
      localState: stateToFlat(
        terminal.state as unknown as Record<string, StateEntry>,
      ),
      globalState: stateToFlat(
        campaign.state as unknown as Record<string, StateEntry>,
      ),
    };
  }

  async export(id: string) {
    const terminal = await this.terminalModel.findById(id).lean();
    if (!terminal) throw new NotFoundException();

    const fictionalUsers = await this.fictionalUserModel
      .find({ terminalId: terminal._id })
      .lean();

    const content = withInjectedMetaId({ ...terminal.content }, terminal._id);
    if (fictionalUsers.length > 0) {
      content.login = {
        users: fictionalUsers.map((u) => ({
          username: u.username,
          password: u.password,
        })),
      };
    }

    const meta = { ...(content.meta as Record<string, unknown>) };
    delete meta.id;
    if (meta.hiddenId === null) delete meta.hiddenId;
    content.meta = meta;

    return content;
  }

  async fictionalLogin(id: string, username: string, password: string) {
    const fictionalUser = await this.fictionalUserModel
      .findOne({ terminalId: new Types.ObjectId(id), username })
      .lean();

    if (!fictionalUser || fictionalUser.password !== password) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return { ok: true, username };
  }

  private toSummary(terminal: Terminal & { _id: unknown }) {
    const content = terminal.content;
    const meta = content?.meta as Record<string, unknown> | undefined;
    const summary: Record<string, unknown> = {
      id: String(terminal._id),
      campaignId: String((terminal as { campaignId: unknown }).campaignId),
      title: terminal.title,
      isPublic: meta?.public ?? false,
      viewCount: terminal.viewCount ?? 0,
      createdAt: terminal.createdAt,
      updatedAt: terminal.updatedAt,
    };
    if (typeof meta?.hiddenId === 'string' && meta.hiddenId) {
      summary.hiddenId = meta.hiddenId;
    }
    return summary;
  }
}
