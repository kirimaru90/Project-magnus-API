import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type CharacterDocument = Character & Document;

// ─── Sub-schemas ──────────────────────────────────────────────
// Collection elements carry a server-minted `id` (nanoid) so section
// PATCH endpoints can diff by id (update by id, create on id-less,
// remove via deletedIds). Skills are the exception: their `id` is a
// caller-supplied catalog slug, never server-minted.

// Tags are leaf objects (no id): a weapon/equip PATCH replaces its tags array wholesale.
@Schema({ _id: false })
export class Tag {
  @Prop({ required: true })
  name: string;

  @Prop({ type: String, enum: ['core', 'extra'], required: true })
  type: string;

  @Prop({ default: false })
  damaged?: boolean;
}
export const TagSchema = SchemaFactory.createForClass(Tag);

@Schema({ _id: false })
export class Condition {
  @Prop({ required: true }) // server-minted nanoid
  id: string;

  @Prop({ required: true })
  name: string;

  @Prop({ type: String, enum: ['minor', 'major'], default: 'minor' })
  severity: string;

  @Prop()
  description?: string;
}
export const ConditionSchema = SchemaFactory.createForClass(Condition);

@Schema({ _id: false })
export class CharacterSkill {
  @Prop({ required: true }) // catalog slug (e.g. "lockpick")
  id: string;

  @Prop({
    type: String,
    enum: ['competent', 'expert', 'master'],
    required: true,
  })
  level: string;
}
export const CharacterSkillSchema =
  SchemaFactory.createForClass(CharacterSkill);

@Schema({ _id: false })
export class CharacterPerk {
  @Prop({ required: true }) // server-minted nanoid
  id: string;

  @Prop({ required: true })
  name: string;

  @Prop()
  description?: string;

  @Prop()
  icon?: string;
}
export const CharacterPerkSchema = SchemaFactory.createForClass(CharacterPerk);

@Schema({ _id: false })
export class WeaponItem {
  @Prop({ required: true }) // server-minted nanoid, unique across inventory
  id: string;

  @Prop({ required: true })
  name: string;

  @Prop({ type: [TagSchema], default: [] })
  tags: Tag[];

  @Prop({ default: false })
  broken: boolean;
}
export const WeaponItemSchema = SchemaFactory.createForClass(WeaponItem);

@Schema({ _id: false })
export class EquipItem {
  @Prop({ required: true }) // server-minted nanoid, unique across inventory
  id: string;

  @Prop({ required: true })
  name: string;

  @Prop({ type: [TagSchema], default: [] })
  tags: Tag[];

  @Prop({ default: false })
  broken: boolean;
}
export const EquipItemSchema = SchemaFactory.createForClass(EquipItem);

@Schema({ _id: false })
export class ConsumableItem {
  @Prop({ required: true }) // server-minted nanoid, unique across inventory
  id: string;

  @Prop({ required: true })
  name: string;

  @Prop()
  description?: string;

  @Prop({ type: Number, min: 0, default: 0 })
  quantity: number;
}
export const ConsumableItemSchema =
  SchemaFactory.createForClass(ConsumableItem);

@Schema({ _id: false })
export class GenericItem {
  @Prop({ required: true }) // server-minted nanoid, unique across inventory
  id: string;

  @Prop({ required: true })
  name: string;

  @Prop()
  description?: string;

  @Prop({ type: Number, min: 0, default: 0 })
  quantity: number;
}
export const GenericItemSchema = SchemaFactory.createForClass(GenericItem);

@Schema({ _id: false })
export class SpecialSection {
  @Prop({ type: Number, min: 1, max: 5, default: 1 })
  strength: number;

  @Prop({ type: Number, min: 1, max: 5, default: 1 })
  perception: number;

  @Prop({ type: Number, min: 1, max: 5, default: 1 })
  endurance: number;

  @Prop({ type: Number, min: 1, max: 5, default: 1 })
  charisma: number;

  @Prop({ type: Number, min: 1, max: 5, default: 1 })
  intelligence: number;

  @Prop({ type: Number, min: 1, max: 5, default: 1 })
  agility: number;

  @Prop({ type: Number, min: 1, max: 5, default: 1 })
  luck: number;
}
export const SpecialSectionSchema =
  SchemaFactory.createForClass(SpecialSection);

@Schema({ _id: false })
export class ResourcesSection {
  @Prop({ type: Number, min: 0, default: 0 })
  caps: number;

  @Prop({ type: Number, min: 0, default: 0 })
  bobbleheads: number;

  @Prop({ type: Number, min: 0, default: 0 })
  scraps: number;
}
export const ResourcesSectionSchema =
  SchemaFactory.createForClass(ResourcesSection);

@Schema({ _id: false })
export class InventorySection {
  @Prop({ type: [WeaponItemSchema], default: [] })
  weapons: WeaponItem[];

  @Prop({ type: [EquipItemSchema], default: [] })
  equip: EquipItem[];

  @Prop({ type: [ConsumableItemSchema], default: [] })
  consumables: ConsumableItem[];

  @Prop({ type: [GenericItemSchema], default: [] })
  other: GenericItem[];
}
export const InventorySectionSchema =
  SchemaFactory.createForClass(InventorySection);

// ─── Root schema ──────────────────────────────────────────────

@Schema({ timestamps: true })
export class Character {
  // --- Ownership / scoping ---
  @Prop({ required: true, type: Types.ObjectId, index: true })
  campaignId: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId })
  userId: Types.ObjectId;

  // --- Identity ---
  @Prop({ required: true })
  name: string;

  @Prop({
    type: String,
    enum: ['human', 'ghoul', 'super_mutant', 'robot'],
    default: 'human',
  })
  species: string;

  // --- S.P.E.C.I.A.L. ---
  @Prop({ type: SpecialSectionSchema, default: () => ({}) })
  special: SpecialSection;

  // --- Skills ---
  @Prop({ type: [CharacterSkillSchema], default: [] })
  skills: CharacterSkill[];

  // --- Action Points ---
  @Prop({ type: Number, min: 0 })
  paMax?: number;

  @Prop({ type: Number, min: 0 })
  paCurrent?: number;

  @Prop({ type: String, enum: ['agility', 'endurance'] })
  paTrackedBy?: string;

  // --- Status ---
  @Prop({ type: [ConditionSchema], default: [] })
  positiveConditions: Condition[];

  @Prop({ type: [ConditionSchema], default: [] })
  negativeConditions: Condition[];

  @Prop({ default: false })
  criticalState: boolean;

  // --- Perks ---
  @Prop({ type: [CharacterPerkSchema], default: [] })
  perks: CharacterPerk[];

  // --- Resources (numeric counters, split from inventory) ---
  @Prop({ type: ResourcesSectionSchema, default: () => ({}) })
  resources: ResourcesSection;

  // --- Inventory (items only) ---
  @Prop({ type: InventorySectionSchema, default: () => ({}) })
  inventory: InventorySection;

  // --- Soft-delete ---
  @Prop({ default: false })
  isDeleted: boolean;

  @Prop({ type: Date })
  deletedAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}

export const CharacterSchema = SchemaFactory.createForClass(Character);
CharacterSchema.index({ campaignId: 1, isDeleted: 1 });
CharacterSchema.index({ campaignId: 1, userId: 1, isDeleted: 1 });
