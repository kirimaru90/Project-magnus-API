## 1. Schema

- [x] 1.1 Add `nanoid` to `api` dependencies
- [x] 1.2 Create `api/src/characters/schemas/character.schema.ts` — port sub-schemas as NestJS `@Schema({ _id: false })` classes: `Tag`, `Condition` (+`id: string`), `CharacterSkill` (`id` = catalog slug, `level`), `CharacterPerk` (+`id: string`), `WeaponItem`/`EquipItem` (+`id: string`, `tags`, `broken`), `ConsumableItem`/`GenericItem` (+`id: string`, `quantity`), `SpecialSection`, `ResourcesSection` (caps/bobbleheads/scraps), `InventorySection` (weapons/equip/consumables/other)
- [x] 1.3 Emit each sub-schema via `SchemaFactory.createForClass(X)` so the root can reference `ConditionSchema`, `CharacterSkillSchema`, `WeaponItemSchema`, etc.
- [x] 1.4 Define root `Character` class with `campaignId`/`userId` as `Types.ObjectId` (campaignId `index: true`), `name`, `species`, `special`, `skills`, `paMax`/`paCurrent`/`paTrackedBy`, `positiveConditions`/`negativeConditions`/`criticalState`, `perks`, `resources`, `inventory`, `isDeleted`, `deletedAt`; export `type CharacterDocument = Character & Document` and `CharacterSchema = SchemaFactory.createForClass(Character)`
- [x] 1.5 Add indexes `{ campaignId: 1, isDeleted: 1 }` and `{ campaignId: 1, userId: 1, isDeleted: 1 }` for list queries

## 2. Patch engine & authorization utilities

- [x] 2.1 Create `patchCollectionArray<T>(existing, items, deletedIds)` helper — remove `deletedIds` first, then for each item: `id` present & found → shallow-merge, `id` present & not found → silently skip, `id` absent → create with `nanoid(8)`
- [x] 2.2 Create a skills-specific patch variant — same shape but `id` present & not found → **insert** (catalog attach), `id` absent → throw 400; never mint nanoid
- [x] 2.3 Define `PLAYER_UPDATABLE_FIELDS` map: `special: []`, `skills: []`, `perks: []`, `actionPoints: ['paCurrent']`, `resources: ['caps','scraps']`, `status: '*'`, `inventory: '*'`
- [x] 2.4 Create a payload-scrubbing helper — admins bypass; for non-admins, silently drop any section/field not whitelisted (no 403). Treat `'*'` sentinel as "allow whole section"

## 3. DTOs

- [x] 3.1 `dto/create-character.dto.ts` — `name` (required), `species?` (enum), `userId?` (string, admin-only)
- [x] 3.2 `dto/update-character.dto.ts` — full mutable character body (used by the full `PUT`; whitelist still applied for non-admins)
- [x] 3.3 `dto/patch-special.dto.ts` — all 7 attributes optional, each number 1–5 when present
- [x] 3.4 `dto/patch-skills.dto.ts` — `items?: [{ id, level }]`, `deletedIds?: string[]`
- [x] 3.5 `dto/patch-perks.dto.ts` — `items?: [{ id?, name?, description?, icon? }]`, `deletedIds?: string[]`
- [x] 3.6 `dto/patch-status.dto.ts` — `positiveConditions?: { items, deletedIds }`, `negativeConditions?: { items, deletedIds }`, `criticalState?: boolean`; condition = `{ id?, name?, severity?, description? }`
- [x] 3.7 `dto/patch-action-points.dto.ts` — `paMax?`, `paCurrent?`, `paTrackedBy?` (all optional, validated when present)
- [x] 3.8 `dto/patch-inventory.dto.ts` — `weapons?/equip?/consumables?/other?`, each `{ items, deletedIds }`; item validation (name on create, quantity ≥ 0, tag `type` enum)
- [x] 3.9 `dto/patch-resources.dto.ts` — `caps?`, `bobbleheads?`, `scraps?` (number ≥ 0 when present)

## 4. Guard

- [x] 4.1 Create `api/src/common/guards/character-owner.guard.ts` — load character by `req.params.characterId`, 404 if missing or soft-deleted, pass if admin, pass if `character.userId === req.user.id`, else 404

## 5. Service

- [x] 5.1 Create `api/src/characters/characters.service.ts` with `list(campaignId, actor)`, `create(campaignId, dto, actor)`, `findById(campaignId, characterId)`, `update(id, dto, actor)`, `softDelete(id)` — all read queries filter `{ isDeleted: { $ne: true } }`
- [x] 5.2 In `create()`: validate target `userId` ∈ `campaign.players`; infer `userId` from JWT for players (reject body `userId`); require body `userId` for admins
- [x] 5.3 Add section patch methods `patchSpecial`, `patchSkills`, `patchPerks`, `patchStatus`, `patchActionPoints`, `patchInventory`, `patchResources` — each scrubs the payload via the whitelist (§2.4), applies partial-merge or the patch engine (§2.1/§2.2), persists, and **returns only the mutated section**
- [x] 5.4 Apply the whitelist scrub to the full `update()` path too, so a non-admin `PUT` cannot overwrite admin-only sections/fields
- [x] 5.5 Implement `toResponse()` — exclude `isDeleted`/`deletedAt`/`__v`, stringify `_id`/`userId`/`campaignId`

## 6. Controller

- [x] 6.1 Create `api/src/characters/characters.controller.ts` — `@Controller('campaigns/:campaignId/characters')`, `@ApiTags('characters')`, controller-level `JwtRequired` + `CampaignAccessGuard`
- [x] 6.2 Wire CRUD routes `GET /`, `POST /`, `GET /:characterId`, `PUT /:characterId`, `DELETE /:characterId`; apply `CharacterOwnerGuard` on `/:characterId` and below
- [x] 6.3 Wire 7 section routes as `PATCH /:characterId/{special,skills,perks,status,action-points,inventory,resources}`, each returning the mutated section object only

## 7. Module & registration

- [x] 7.1 Create `api/src/characters/characters.module.ts` — `MongooseModule.forFeature` for Character + Campaign, provide `CharactersService` + `CharacterOwnerGuard`, declare controller
- [x] 7.2 Import `CharactersModule` into `api/src/app.module.ts`

## 8. Verification

- [x] 8.1 Start the server and confirm all 12 routes appear in Swagger UI at `/api`
- [x] 8.2 Smoke-test: create player, add to campaign, create character as player, GET returns it
- [x] 8.3 Smoke-test: player cannot access another player's character (404)
- [x] 8.4 Smoke-test PATCH diffing: id-less create assigns an id, id update merges, `deletedIds` removes, unknown id is silently skipped; response is the section only
- [x] 8.5 Smoke-test RBAC: player PATCH to `/special` and `/skills` is silently ignored (200, unchanged); player can edit `paCurrent`, `caps`/`scraps`, status, inventory; bobbleheads/paMax ignored for players
- [x] 8.6 Smoke-test skills: admin attaches a catalog skill by slug, changes its level, detaches it; id-less skill item → 400
- [x] 8.7 Smoke-test: DELETE character and verify it no longer appears in list

## 9. Amendments — observability & id integrity

These refine the section-PATCH behaviour above; each depends on the patch engine (§2.1–2.2) and/or the section patch methods and routes (§5.3, §6.3).

- [ ] 9.1 Replace the `patchCollectionArray` signature with `patchCollectionArray(existing, items, deletedIds, { onIdless, onUnknownId })`; nanoid callers pass `{ onIdless: 'create', onUnknownId: 'skip' }`, skills pass `{ onIdless: 'reject400', onUnknownId: 'insert' }`; fold the skills-specific variant (§2.2) into this options path so there is no `is-skills` branch (depends on §2.1, §2.2)
- [ ] 9.2 Test: `patchCollectionArray` honours both option combinations — id-less under `create` mints an id while id-less under `reject400` throws 400; unknown id under `skip` is dropped while unknown id under `insert` is added
- [ ] 9.3 Have each section patch method collect dropped inputs and return the envelope `{ section, ignored }`, where each `ignored` entry carries `{ section, key|id, reason }` with `reason` ∈ `unauthorized_field | unknown_id | disallowed_section` (depends on §5.3, §6.3)
- [ ] 9.4 Test: a non-admin PATCH to an admin-only field returns 200 with an `ignored` entry (`unauthorized_field`); an unknown nanoid id returns an `ignored` entry (`unknown_id`); a clean PATCH returns `ignored: []`
- [ ] 9.5 On inventory create, after `nanoid(8)` mints an id, check it against all four item arrays (weapons, equip, consumables, other) already loaded in the read-modify-write cycle and regenerate on collision (depends on §5.3, §2.1)
- [ ] 9.6 Test: creating items across arrays never yields a cross-array id collision (seed/force a collision and assert the id is regenerated)
- [ ] 9.7 Ensure the scrub-then-save flow makes the returned `section` reflect the unchanged persisted value of any purged field (e.g. a non-admin `resources` PATCH returns the original `bobbleheads`) (depends on §5.3, §9.3)
- [ ] 9.8 Test: a non-admin `resources` PATCH with `bobbleheads` returns the original `bobbleheads` in `section` plus the matching `unauthorized_field` entry in `ignored`
