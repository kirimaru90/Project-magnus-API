import mongoose, { Schema } from 'mongoose';

// ─── Sub-schemas ──────────────────────────────────────────────
// Collection elements carry a server-minted `id` (nanoid) so section
// PATCH endpoints can diff by id (update by id, create on id-less,
// remove via deletedIds). Skills are the exception: their `id` is a
// caller-supplied catalog slug, never server-minted.

const ConditionSchema = new Schema({
  id:          { type: String, required: true }, // server-minted nanoid
  name:        { type: String, required: true },
  severity:    { type: String, enum: ['minor', 'major'], default: 'minor' },
  description: { type: String }
}, { _id: false });

const SkillSchema = new Schema({
  id:    { type: String, required: true }, // catalog slug (e.g. "lockpick")
  level: { type: String, enum: ['competent', 'expert', 'master'], required: true }
}, { _id: false });

const PerkSchema = new Schema({
  id:          { type: String, required: true }, // server-minted nanoid
  name:        { type: String, required: true },
  description: { type: String },
  icon:        { type: String }
}, { _id: false });

const SpecialSchema = new Schema({
  strength:     { type: Number, min: 1, max: 5, default: 1 },
  perception:   { type: Number, min: 1, max: 5, default: 1 },
  endurance:    { type: Number, min: 1, max: 5, default: 1 },
  charisma:     { type: Number, min: 1, max: 5, default: 1 },
  intelligence: { type: Number, min: 1, max: 5, default: 1 },
  agility:      { type: Number, min: 1, max: 5, default: 1 },
  luck:         { type: Number, min: 1, max: 5, default: 1 }
}, { _id: false });

// Tags are leaf objects (no id): a weapon/equip PATCH replaces its tags array wholesale.
const TagSchema = new Schema({
  name:    { type: String, required: true },
  type:    { type: String, enum: ['core', 'extra'], required: true },
  damaged: { type: Boolean, default: false }
}, { _id: false });

const WeaponSchema = new Schema({
  id:     { type: String, required: true }, // server-minted nanoid, unique across inventory
  name:   { type: String, required: true },
  tags:   { type: [TagSchema], default: [] },
  broken: { type: Boolean, default: false }
}, { _id: false });

const EquipSchema = new Schema({
  id:     { type: String, required: true }, // server-minted nanoid, unique across inventory
  name:   { type: String, required: true },
  tags:   { type: [TagSchema], default: [] },
  broken: { type: Boolean, default: false }
}, { _id: false });

const ConsumableSchema = new Schema({
  id:          { type: String, required: true }, // server-minted nanoid, unique across inventory
  name:        { type: String, required: true },
  description: { type: String },
  quantity:    { type: Number, min: 0, default: 0 }
}, { _id: false });

const GenericItemSchema = new Schema({
  id:          { type: String, required: true }, // server-minted nanoid, unique across inventory
  name:        { type: String, required: true },
  description: { type: String },
  quantity:    { type: Number, min: 0, default: 0 }
}, { _id: false });

const ResourcesSchema = new Schema({
  caps:        { type: Number, min: 0, default: 0 },
  bobbleheads: { type: Number, min: 0, default: 0 },
  scraps:      { type: Number, min: 0, default: 0 }
}, { _id: false });

// ─── Root schema ──────────────────────────────────────────────

const CharacterSchema = new Schema({
  // --- Ownership / scoping ---
  campaignId: { type: Schema.Types.ObjectId, ref: 'Campaign', required: true, index: true },
  userId:     { type: Schema.Types.ObjectId, ref: 'User', required: true },

  // --- Identity ---
  name:    { type: String, required: true },
  species: {
    type:    String,
    enum:    ['human', 'ghoul', 'super_mutant', 'robot'],
    default: 'human'
  },

  // --- S.P.E.C.I.A.L. ---
  special: { type: SpecialSchema, default: () => ({}) },

  // --- Skills ---
  skills: { type: [SkillSchema], default: [] },

  // --- Action Points ---
  paMax:       { type: Number, min: 0 },
  paCurrent:   { type: Number, min: 0 },
  paTrackedBy: { type: String, enum: ['agility', 'endurance'] },

  // --- Status ---
  negativeConditions: { type: [ConditionSchema], default: [] },
  positiveConditions: { type: [ConditionSchema], default: [] },
  criticalState:      { type: Boolean, default: false },

  // --- Perks ---
  perks: { type: [PerkSchema], default: [] },

  // --- Inventory (items only) ---
  inventory: {
    weapons:     { type: [WeaponSchema],      default: [] },
    equip:       { type: [EquipSchema],       default: [] },
    consumables: { type: [ConsumableSchema],  default: [] },
    other:       { type: [GenericItemSchema], default: [] }
  },

  // --- Resources (numeric counters, split from inventory) ---
  resources: { type: ResourcesSchema, default: () => ({}) },

  // --- Soft-delete ---
  isDeleted: { type: Boolean, default: false, index: true },
  deletedAt: { type: Date }

}, { timestamps: true });

export default mongoose.model('Character', CharacterSchema);
