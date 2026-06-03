import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { nanoid } from 'nanoid';
import { Character, CharacterDocument } from './schemas/character.schema';
import {
  Campaign,
  CampaignDocument,
} from '../campaigns/schemas/campaign.schema';
import { AuthenticatedUser } from '../auth/jwt.strategy';
import {
  Identified,
  IgnoredEntry,
  PatchItem,
  patchCollectionArray,
  scrubPayload,
} from './patch-utils';
import { CreateCharacterDto } from './dto/create-character.dto';
import { UpdateCharacterDto } from './dto/update-character.dto';
import { PatchSpecialDto } from './dto/patch-special.dto';
import { PatchSkillsDto } from './dto/patch-skills.dto';
import { PatchPerksDto } from './dto/patch-perks.dto';
import { PatchStatusDto } from './dto/patch-status.dto';
import { PatchActionPointsDto } from './dto/patch-action-points.dto';
import { PatchInventoryDto } from './dto/patch-inventory.dto';
import { PatchResourcesDto } from './dto/patch-resources.dto';

/** A character loaded via `.lean()` — plain object with an ObjectId `_id`. */
type LeanCharacter = Character & { _id: Types.ObjectId };

/** Mint a nanoid for any element that arrives without an id (server-minted collections). */
function assignIds<T extends Identified>(items: PatchItem<T>[]): T[] {
  return items.map((item) =>
    item.id ? (item as T) : ({ ...item, id: nanoid(8) } as T),
  );
}

function toResponse(c: LeanCharacter) {
  return {
    id: String(c._id),
    campaignId: String(c.campaignId),
    userId: String(c.userId),
    name: c.name,
    species: c.species,
    special: c.special,
    skills: c.skills ?? [],
    actionPoints: {
      paMax: c.paMax,
      paCurrent: c.paCurrent,
      paTrackedBy: c.paTrackedBy,
    },
    status: {
      positiveConditions: c.positiveConditions ?? [],
      negativeConditions: c.negativeConditions ?? [],
      criticalState: c.criticalState ?? false,
    },
    perks: c.perks ?? [],
    resources: c.resources,
    inventory: c.inventory,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

@Injectable()
export class CharactersService {
  constructor(
    @InjectModel(Character.name)
    private characterModel: Model<CharacterDocument>,
    @InjectModel(Campaign.name) private campaignModel: Model<CampaignDocument>,
  ) {}

  // --- CRUD ---

  async list(campaignId: string, actor: AuthenticatedUser) {
    const filter: Record<string, unknown> = {
      campaignId: new Types.ObjectId(campaignId),
      isDeleted: { $ne: true },
    };
    if (actor.role !== 'admin') {
      filter.userId = new Types.ObjectId(actor.id);
    }
    const characters = await this.characterModel
      .find(filter)
      .lean<LeanCharacter[]>();
    return characters.map(toResponse);
  }

  async create(
    campaignId: string,
    dto: CreateCharacterDto,
    actor: AuthenticatedUser,
  ) {
    let userId: string;
    if (actor.role === 'admin') {
      if (!dto.userId)
        throw new BadRequestException(
          'userId is required when creating as admin',
        );
      userId = dto.userId;
    } else {
      // Players always create characters for themselves; any body userId is ignored.
      userId = actor.id;
    }

    if (!Types.ObjectId.isValid(userId))
      throw new BadRequestException('Invalid userId');

    const campaign = await this.campaignModel.findById(campaignId).lean();
    if (!campaign) throw new NotFoundException();

    const isMember = campaign.players.some((pid) => pid.toString() === userId);
    if (!isMember)
      throw new BadRequestException('userId must belong to a campaign member');

    const created = await this.characterModel.create({
      campaignId: new Types.ObjectId(campaignId),
      userId: new Types.ObjectId(userId),
      name: dto.name,
      ...(dto.species ? { species: dto.species } : {}),
    });
    return toResponse(created.toObject() as LeanCharacter);
  }

  async findById(campaignId: string, characterId: string) {
    const character = await this.loadOr404(campaignId, characterId);
    return toResponse(character);
  }

  async softDelete(campaignId: string, characterId: string) {
    if (!Types.ObjectId.isValid(characterId)) throw new NotFoundException();
    const result = await this.characterModel.findOneAndUpdate(
      {
        _id: new Types.ObjectId(characterId),
        campaignId: new Types.ObjectId(campaignId),
        isDeleted: { $ne: true },
      },
      { $set: { isDeleted: true, deletedAt: new Date() } },
    );
    if (!result) throw new NotFoundException();
  }

  async update(
    campaignId: string,
    characterId: string,
    dto: UpdateCharacterDto,
    actor: AuthenticatedUser,
  ) {
    const existing = await this.loadOr404(campaignId, characterId);
    const s = this.scrubUpdate(dto, actor);

    const set: Record<string, unknown> = {};
    if (s.name !== undefined) set.name = s.name;
    if (s.species !== undefined) set.species = s.species;
    if (s.special) set.special = { ...existing.special, ...s.special };
    if (s.skills) set.skills = s.skills;
    if (s.perks) set.perks = assignIds(s.perks);
    if (s.actionPoints) {
      const ap = s.actionPoints;
      if (ap.paMax !== undefined) set.paMax = ap.paMax;
      if (ap.paCurrent !== undefined) set.paCurrent = ap.paCurrent;
      if (ap.paTrackedBy !== undefined) set.paTrackedBy = ap.paTrackedBy;
    }
    if (s.status) {
      if (s.status.positiveConditions)
        set.positiveConditions = assignIds(s.status.positiveConditions);
      if (s.status.negativeConditions)
        set.negativeConditions = assignIds(s.status.negativeConditions);
      if (s.status.criticalState !== undefined)
        set.criticalState = s.status.criticalState;
    }
    if (s.resources) set.resources = { ...existing.resources, ...s.resources };
    if (s.inventory) {
      const inv = s.inventory;
      set.inventory = {
        weapons: assignIds(inv.weapons ?? existing.inventory.weapons),
        equip: assignIds(inv.equip ?? existing.inventory.equip),
        consumables: assignIds(
          inv.consumables ?? existing.inventory.consumables,
        ),
        other: assignIds(inv.other ?? existing.inventory.other),
      };
    }

    const updated = await this.characterModel
      .findByIdAndUpdate(existing._id, { $set: set }, { new: true })
      .lean<LeanCharacter>();
    return toResponse(updated!);
  }

  // --- Section patches (each returns { section, ignored }) ---

  async patchSpecial(
    campaignId: string,
    characterId: string,
    dto: PatchSpecialDto,
    actor: AuthenticatedUser,
  ) {
    const existing = await this.loadOr404(campaignId, characterId);
    const { scrubbed, ignored } = scrubPayload('special', { ...dto }, actor);
    const special = { ...existing.special, ...scrubbed };
    const updated = await this.persist(existing._id, { special });
    return { section: updated.special, ignored };
  }

  async patchSkills(
    campaignId: string,
    characterId: string,
    dto: PatchSkillsDto,
    actor: AuthenticatedUser,
  ) {
    const existing = await this.loadOr404(campaignId, characterId);
    const { scrubbed, ignored } = scrubPayload('skills', { ...dto }, actor);
    const { result: skills } = patchCollectionArray(
      existing.skills ?? [],
      scrubbed.items,
      scrubbed.deletedIds,
      { onIdless: 'reject400', onUnknownId: 'insert' },
    );
    const updated = await this.persist(existing._id, { skills });
    return { section: updated.skills, ignored };
  }

  async patchPerks(
    campaignId: string,
    characterId: string,
    dto: PatchPerksDto,
    actor: AuthenticatedUser,
  ) {
    const existing = await this.loadOr404(campaignId, characterId);
    const { scrubbed, ignored: scrubIgnored } = scrubPayload(
      'perks',
      { ...dto },
      actor,
    );
    const { result: perks, unknownIds } = patchCollectionArray(
      existing.perks ?? [],
      scrubbed.items,
      scrubbed.deletedIds,
      { onIdless: 'create', onUnknownId: 'skip' },
    );
    const updated = await this.persist(existing._id, { perks });
    const ignored: IgnoredEntry[] = [
      ...scrubIgnored,
      ...unknownIds.map(
        (id): IgnoredEntry => ({ section: 'perks', id, reason: 'unknown_id' }),
      ),
    ];
    return { section: updated.perks, ignored };
  }

  async patchStatus(
    campaignId: string,
    characterId: string,
    dto: PatchStatusDto,
    actor: AuthenticatedUser,
  ) {
    const existing = await this.loadOr404(campaignId, characterId);
    const { scrubbed, ignored: scrubIgnored } = scrubPayload(
      'status',
      { ...dto },
      actor,
    );
    const ignored: IgnoredEntry[] = [...scrubIgnored];

    const set: Record<string, unknown> = {};
    if (scrubbed.positiveConditions) {
      const { result, unknownIds } = patchCollectionArray(
        existing.positiveConditions ?? [],
        scrubbed.positiveConditions.items,
        scrubbed.positiveConditions.deletedIds,
        { onIdless: 'create', onUnknownId: 'skip' },
      );
      set.positiveConditions = result;
      unknownIds.forEach((id) =>
        ignored.push({ section: 'status', id, reason: 'unknown_id' }),
      );
    }
    if (scrubbed.negativeConditions) {
      const { result, unknownIds } = patchCollectionArray(
        existing.negativeConditions ?? [],
        scrubbed.negativeConditions.items,
        scrubbed.negativeConditions.deletedIds,
        { onIdless: 'create', onUnknownId: 'skip' },
      );
      set.negativeConditions = result;
      unknownIds.forEach((id) =>
        ignored.push({ section: 'status', id, reason: 'unknown_id' }),
      );
    }
    if (scrubbed.criticalState !== undefined)
      set.criticalState = scrubbed.criticalState;

    const updated = await this.persist(existing._id, set);
    const section = {
      positiveConditions: updated.positiveConditions ?? [],
      negativeConditions: updated.negativeConditions ?? [],
      criticalState: updated.criticalState ?? false,
    };
    return { section, ignored };
  }

  async patchActionPoints(
    campaignId: string,
    characterId: string,
    dto: PatchActionPointsDto,
    actor: AuthenticatedUser,
  ) {
    const existing = await this.loadOr404(campaignId, characterId);
    const { scrubbed, ignored } = scrubPayload(
      'actionPoints',
      { ...dto },
      actor,
    );

    const set: Record<string, unknown> = {};
    if (scrubbed.paMax !== undefined) set.paMax = scrubbed.paMax;
    if (scrubbed.paCurrent !== undefined) set.paCurrent = scrubbed.paCurrent;
    if (scrubbed.paTrackedBy !== undefined)
      set.paTrackedBy = scrubbed.paTrackedBy;

    const updated = await this.persist(existing._id, set);
    const section = {
      paMax: updated.paMax,
      paCurrent: updated.paCurrent,
      paTrackedBy: updated.paTrackedBy,
    };
    return { section, ignored };
  }

  async patchInventory(
    campaignId: string,
    characterId: string,
    dto: PatchInventoryDto,
    actor: AuthenticatedUser,
  ) {
    const existing = await this.loadOr404(campaignId, characterId);
    const { scrubbed, ignored: scrubIgnored } = scrubPayload(
      'inventory',
      { ...dto },
      actor,
    );
    const ignored: IgnoredEntry[] = [...scrubIgnored];

    // Build cross-array id pool so minted ids are unique across all four arrays.
    const inv = existing.inventory;
    const idPool = new Set<string>([
      ...(inv.weapons ?? []).map((i) => i.id),
      ...(inv.equip ?? []).map((i) => i.id),
      ...(inv.consumables ?? []).map((i) => i.id),
      ...(inv.other ?? []).map((i) => i.id),
    ]);

    const inventory = {
      weapons: inv.weapons ?? [],
      equip: inv.equip ?? [],
      consumables: inv.consumables ?? [],
      other: inv.other ?? [],
    };

    if (scrubbed.weapons) {
      const { result, unknownIds } = patchCollectionArray(
        inventory.weapons,
        scrubbed.weapons.items,
        scrubbed.weapons.deletedIds,
        { onIdless: 'create', onUnknownId: 'skip', idPool },
      );
      inventory.weapons = result as typeof inventory.weapons;
      unknownIds.forEach((id) =>
        ignored.push({ section: 'inventory', id, reason: 'unknown_id' }),
      );
    }
    if (scrubbed.equip) {
      const { result, unknownIds } = patchCollectionArray(
        inventory.equip,
        scrubbed.equip.items,
        scrubbed.equip.deletedIds,
        { onIdless: 'create', onUnknownId: 'skip', idPool },
      );
      inventory.equip = result as typeof inventory.equip;
      unknownIds.forEach((id) =>
        ignored.push({ section: 'inventory', id, reason: 'unknown_id' }),
      );
    }
    if (scrubbed.consumables) {
      const { result, unknownIds } = patchCollectionArray(
        inventory.consumables,
        scrubbed.consumables.items,
        scrubbed.consumables.deletedIds,
        { onIdless: 'create', onUnknownId: 'skip', idPool },
      );
      inventory.consumables = result as typeof inventory.consumables;
      unknownIds.forEach((id) =>
        ignored.push({ section: 'inventory', id, reason: 'unknown_id' }),
      );
    }
    if (scrubbed.other) {
      const { result, unknownIds } = patchCollectionArray(
        inventory.other,
        scrubbed.other.items,
        scrubbed.other.deletedIds,
        { onIdless: 'create', onUnknownId: 'skip', idPool },
      );
      inventory.other = result as typeof inventory.other;
      unknownIds.forEach((id) =>
        ignored.push({ section: 'inventory', id, reason: 'unknown_id' }),
      );
    }

    const updated = await this.persist(existing._id, { inventory });
    return { section: updated.inventory, ignored };
  }

  async patchResources(
    campaignId: string,
    characterId: string,
    dto: PatchResourcesDto,
    actor: AuthenticatedUser,
  ) {
    const existing = await this.loadOr404(campaignId, characterId);
    const { scrubbed, ignored } = scrubPayload('resources', { ...dto }, actor);
    const resources = { ...existing.resources, ...scrubbed };
    const updated = await this.persist(existing._id, { resources });
    return { section: updated.resources, ignored };
  }

  // --- Internals ---

  private async loadOr404(
    campaignId: string,
    characterId: string,
  ): Promise<LeanCharacter> {
    if (!Types.ObjectId.isValid(characterId)) throw new NotFoundException();
    const character = await this.characterModel
      .findOne({
        _id: new Types.ObjectId(characterId),
        campaignId: new Types.ObjectId(campaignId),
        isDeleted: { $ne: true },
      })
      .lean<LeanCharacter>();
    if (!character) throw new NotFoundException();
    return character;
  }

  private async persist(
    id: Types.ObjectId,
    set: Record<string, unknown>,
  ): Promise<LeanCharacter> {
    const updated = await this.characterModel
      .findByIdAndUpdate(id, { $set: set }, { new: true })
      .lean<LeanCharacter>();
    if (!updated) throw new NotFoundException();
    return updated;
  }

  private scrubUpdate(
    dto: UpdateCharacterDto,
    actor: AuthenticatedUser,
  ): UpdateCharacterDto {
    if (actor.role === 'admin') return dto;
    // Non-admin: identity + player-writable sections only; special/skills/perks dropped.
    const out: UpdateCharacterDto = {};
    if (dto.name !== undefined) out.name = dto.name;
    if (dto.species !== undefined) out.species = dto.species;
    if (dto.actionPoints)
      out.actionPoints = scrubPayload(
        'actionPoints',
        { ...dto.actionPoints },
        actor,
      ).scrubbed;
    if (dto.resources)
      out.resources = scrubPayload(
        'resources',
        { ...dto.resources },
        actor,
      ).scrubbed;
    if (dto.status) out.status = dto.status;
    if (dto.inventory) out.inventory = dto.inventory;
    return out;
  }
}
