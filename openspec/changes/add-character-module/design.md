## Context

The API already has `UsersModule`, `CampaignsModule`, and `TerminalsModule` following a consistent NestJS pattern: Mongoose schema → service with `toResponse()` helper → controller with guard composition → module registration in `AppModule`. The character module follows the same pattern and is nested under campaigns.

The reference schema (`reference/character schemas.ts`) is written in raw Mongoose. It will be ported to NestJS `@Schema`/`@Prop` decorators with nested schema classes.

## Goals / Non-Goals

**Goals:**
- Persist character sheets scoped to a campaign and owned by a player
- Expose full-document CRUD and section-level "set" endpoints
- Enforce player-only-own / admin-all access with existing guard primitives
- Soft-delete via `isDeleted` + `deletedAt` fields

**Non-Goals:**
- Real-time/WebSocket sync (no live session collaboration)
- Game logic (no derived stats, no AP auto-calculation from SPECIAL)
- Character templates or pre-built archetypes
- History / audit log of sheet changes

## Decisions

### 1. Route nesting under campaigns

```
/campaigns/:campaignId/characters[/:characterId[/section]]
```

**Why:** A character is meaningless outside a campaign context. Nesting reuses `CampaignAccessGuard` at the controller level, avoiding a redundant campaign membership check inside `CharactersService`. Consistent with existing `/campaigns/:id/players` sub-resource pattern.

**Alternative considered:** Flat `/characters` with `?campaignId=` query param. Rejected — looser coupling without structural benefit; guard composition becomes awkward.

### 2. Character ownership stored as `userId` (ObjectId ref)

Player's JWT identity is used when a player creates a character (`userId` inferred from `req.user.id`). Admin must pass `userId` explicitly in the request body to create a character on behalf of a player.

**Why:** Keeps the creation endpoint uniform (`POST /campaigns/:cid/characters`) while supporting both actors. No separate "assign" step needed.

### 3. Section endpoints use `PATCH` with id-based diffing

Section endpoints update **incrementally**. Under `PATCH`, omitting an element means "leave it unchanged" — so removals must be signalled explicitly via `deletedIds` (unlike a `PUT`, where absence from the payload would imply deletion).

Sections fall into **three** handling families:

**(a) Partial-merge scalars — fixed keys, no add/remove.** `special`, `action-points`, `resources`, and `status.criticalState`. The body carries only the fields being changed; the "id" is conceptually the field name. These key sets are schema-fixed and never grow or shrink.

```
PATCH /…/special        { "strength": 4, "luck": 2 }
PATCH /…/action-points  { "paCurrent": 3 }
PATCH /…/resources      { "caps": 120 }
```

**(b) Static-slug collection — `skills` only.** Each skill is keyed by a caller-supplied **catalog slug** (`id`), never server-minted. Its semantics differ from the nanoid engine below:
- `id` present, slug not yet on the character → **insert** (admin attaching a catalog skill)
- `id` present, slug already on the character → merge (change `level`)
- `id` in `deletedIds` → detach
- **id-less item → HTTP 400** (a skill must carry its slug)

```
PATCH /…/skills
{ "items": [ { "id": "lockpick", "level": "master" } ], "deletedIds": ["barter"] }
```

**(c) nanoid collections — add / update / remove.** `perks`, `status` conditions (`positiveConditions`, `negativeConditions`), and `inventory` items. Each element carries a server-minted nanoid short string `id`:
- `id` present, found → update (unknown id → **silently skipped**)
- id-less → **create**, server assigns `nanoid(8)`
- `id` in `deletedIds` → remove

```
PATCH /…/perks
{ "items": [ { "id": "a1b2c3d4", "description": "updated" }, { "name": "Bloody Mess" } ], "deletedIds": ["e5f6g7h8"] }

PATCH /…/status
{
  "positiveConditions": { "items": [ { "name": "Well Rested", "severity": "minor" } ], "deletedIds": [] },
  "negativeConditions": { "items": [], "deletedIds": ["k9l0m1n2"] },
  "criticalState": true
}

PATCH /…/inventory
{
  "weapons":     { "items": [ { "id": "a1b2", "broken": true }, { "name": "10mm Pistol" } ], "deletedIds": ["c3d4"] },
  "equip":       { "items": [], "deletedIds": [] },
  "consumables": { "items": [], "deletedIds": [] },
  "other":       { "items": [], "deletedIds": [] }
}
```

A shared `patchCollectionArray(existing, items, deletedIds, options)` helper drives families (b) and (c). The id-less and unknown-id policies are **explicit options**, not a special-case branch keyed on "is this skills":

```
patchCollectionArray(existing, items, deletedIds, {
  onIdless:    'create' | 'reject400',   // id-less item → mint nanoid & insert, or HTTP 400
  onUnknownId: 'skip'   | 'insert',      // id present but not found → drop it, or insert as-is
})
```

- **nanoid collections (family c)** — perks, conditions, inventory — pass `{ onIdless: 'create', onUnknownId: 'skip' }`.
- **skills (family b)** — pass `{ onIdless: 'reject400', onUnknownId: 'insert' }` (a slug must be supplied, and an unknown slug means "attach this catalog skill").

Putting the policy in the signature keeps the contract in the design rather than buried in an `if (section === 'skills')` branch.

On inventory create (`onIdless: 'create'`), after `nanoid(8)` mints an id the service checks it against **all four** item arrays (weapons, equip, consumables, other) — already in hand from the read-modify-write cycle — and regenerates on collision, so ids are unique across the whole inventory, not merely within the one array being patched.

**Response shape:** each section PATCH returns an envelope `{ section: <mutated section object>, ignored: [...] }` — the mutated section (e.g. the `inventory` object), **not** the whole character, plus an `ignored` array enumerating everything the server dropped during partial-apply. Each `ignored` entry carries the `section`, the offending `key` or `id`, and a `reason` code (`unauthorized_field`, `unknown_id`, `disallowed_section`). This keeps the uniform partial-apply contract (nothing becomes a 400) while making silent purge (Decision 7) and silent skip (Decision 8) diagnosable — the client no longer has to diff returned state against what it sent.

**Why id-based PATCH over full-array PUT:** the frontend can push a single changed element without resending the whole array — avoiding lost-update races between concurrent editors and cutting bandwidth on large inventories. An explicit `deletedIds` keeps removals unambiguous now that absence no longer implies deletion.

**Schema impact:** nanoid-collection sub-documents (conditions, perks, inventory items) gain a persisted `id: string`; skills persist their catalog slug as `id`. Sub-schemas keep `{ _id: false }`. Follow existing house style (see terminal.schema.ts / campaign.schema.ts): `campaignId`/`userId` as `Types.ObjectId` (campaignId indexed), `export type CharacterDocument = Character & Document`, and `SchemaFactory.createForClass` for the root **and** every sub-schema (the root references `WeaponItemSchema`, `ConditionSchema`, … which those factory calls produce).

### 4. Soft-delete via `isDeleted` + `deletedAt`

`DELETE /…/:id` sets `{ isDeleted: true, deletedAt: now }`. All queries include `{ isDeleted: { $ne: true } }`. No restore endpoint in scope.

**Why:** Preserves data integrity in a live TTRPG context — accidental deletes should be recoverable by an admin at the database level without needing a full restore API.

### 5. Resources split from inventory

`inventory` contains item arrays (weapons, equip, consumables, other). `resources` contains numeric counters (caps, bobbleheads, scraps). Each has its own section `PATCH` endpoint.

**Why:** Resources change frequently and independently (e.g., spending caps mid-session). Splitting avoids sending the full item arrays when only counters change.

### 6. Access control — new `CharacterOwnerGuard`

A new guard validates that the requesting player owns the character (`character.userId === req.user.id`). Admins bypass this check. Applied on all character-specific routes (`/:characterId` and below).

`CampaignAccessGuard` (existing) is applied at the controller level to verify campaign membership before any character operation.

Guard chain for character routes:
```
JwtRequired → CampaignAccessGuard → CharacterOwnerGuard
```

Admin users pass all guards unconditionally.

### 7. Field-level write authorization (`PLAYER_UPDATABLE_FIELDS`)

Beyond the ownership guards, a section-aware whitelist restricts *which fields/operations a non-admin may write*, applied in the service layer after the guard chain. **Admins bypass it entirely** (raw body accepted). For non-admins the policy is **deny-all**: any section or field not explicitly whitelisted is silently purged from the payload before mutation — no 403.

| Section | Player may write |
|---|---|
| special | — (admin-only) |
| skills | — (admin-only) |
| perks | — (admin-only) |
| action-points | `paCurrent` |
| resources | `caps`, `scraps` (bobbleheads admin-only) |
| status | full — conditions + `criticalState` |
| inventory | full — all four item arrays, full CRUD |

For collection sections marked "full" (status, inventory) the whitelist value is a sentinel (e.g. `'*'`) meaning all of family (c)'s create/update/delete operations are permitted, not a field list.

**Why:** SPECIAL allocation, skill progression, perk grants, and the bobblehead/cap economy are GM-controlled; live-session state (AP spent, caps/scraps spent, conditions, loot) is the player's to manage. Silent purge rather than 403 keeps the contract uniform with the silently-skipped-id behaviour and lets a single PATCH partially apply.

#### 7a. Silent drops are observable via an `ignored` array

Silent purge (this decision) and silent skip (Decision 8) keep the partial-apply contract uniform, but invisibility is a liability — a client cannot tell a dropped field from one that round-tripped unchanged. So every section PATCH response carries an `ignored` array alongside the mutated section (see Decision 3 response shape). Each entry identifies:

- `section` — the section the drop occurred in
- `key` **or** `id` — the offending field name (a purged field) or element id (a skipped/unknown id)
Each entry carries exactly one of key or id: key for a field-level drop (a purged field in a partial-merge or whitelisted section), id for an element-level drop (a skipped or unknown id in a nanoid collection). The disallowed_section case carries neither — only section and reason — since the whole section was denied. Entries never carry both.
- `reason` — one of:
  - `unauthorized_field` — a non-admin wrote a field not in `PLAYER_UPDATABLE_FIELDS`
  - `unknown_id` — a nanoid-collection update referenced an `id` not on the character
  - disallowed_section — a non-admin issued a PATCH against an admin-only section endpoint (special, skills, perks) as a whole

When a non-admin PATCHes an admin-only section, the entire payload is purged: the endpoint still returns 200 with the section unmutated (reflecting current persisted state) and a single ignored entry { section, reason: "disallowed_section" } with no key or id — the denial is wholesale, not field-by-field, so individual fields are not enumerated. This is the one case where a successful (200) write deliberately accomplishes nothing; it is intentional, preserving the uniform partial-apply contract rather than introducing a 403 for this section alone.

Nothing becomes a 400 — the contract stays partial-apply — but the client can now see exactly what the server discarded without diffing returned state.

**Purged-field reflection:** when a non-admin field is purged, the returned `section` reflects the **unchanged persisted value** of that field, not the rejected input. The flow is load → scrub the payload → mutate-in-memory → save, so the rejected field is never applied and the saved-and-returned section is the true persisted state. Example: a non-admin PATCHing `resources` with a `bobbleheads` value gets back a `resources` section showing the *original* `bobbleheads` count, plus an `ignored` entry `{ section: "resources", key: "bobbleheads", reason: "unauthorized_field" }`. This closes the loop with the load-mutate-save cycle.

### 8. Validation model under PATCH

Partial updates change what counts as an error:
- **Missing fields are NOT errors** — partial-merge sections accept any subset; the old "missing attribute → 400" no longer applies.
- **Bad values ARE errors** — out-of-range SPECIAL (1–5), negative counters, invalid enums (`severity`, `level`, `paTrackedBy`, tag `type`), and a missing required `name` on a *created* item still return **HTTP 400**.
- **Unauthorized / unknown keys → silent purge** (per Decision 7), not 400 — and reported in the response `ignored` array (Decision 7a).
- **Unknown update ids → silently skipped** for nanoid collections, reported via `ignored` (Decision 7a); for skills an unknown slug is an **insert**, not a skip (per Decision 3b).

This supersedes the "missing → 400" scenarios currently written in the section specs.

## Risks / Trade-offs

- **PATCH diff complexity**: id-based merge (upsert by id, create on id-less, remove via `deletedIds`) is more logic than a full-array `$set`, and shifts the burden of tracking ids onto the frontend. Accepted in exchange for incremental writes and race-safety on concurrent edits.
- **nanoid uniqueness is enforced on create**: inventory ids must be unique across all four arrays, and this is now guaranteed rather than left to probability. On create, after `nanoid(8)` mints an id the service checks it against all four item arrays already loaded in the read-modify-write cycle and regenerates on collision — so cross-array uniqueness holds regardless of `nanoid(8)`'s collision-resistance, at negligible cost since the arrays are already in memory.
- **Read-modify-write window**: returning the mutated section implies load → mutate-in-memory → save, which reintroduces a server-side lost-update window that atomic array operators (`$[elem]` / `arrayFilters`) would avoid. Accepted given low write-concurrency per character.
- **Silent purge is observable, not invisible** (mitigated): a non-admin writing to an admin-only field still gets no 403, but the response's `ignored` array names the dropped field with a `reason` code and the returned section reflects the unchanged persisted value (Decision 7a). Clients no longer have to diff returned state to notice a drop — the uniform partial-apply contract is preserved while the visibility risk is mitigated, not merely accepted.
- **No uniqueness constraint on characters**: Multiple characters per player per campaign is intentional; no DB-level unique index on `(campaignId, userId)`.
- **Soft-delete invisible to API**: There is no admin endpoint to list or restore soft-deleted characters. If needed later, an admin-only `?includeDeleted=true` query param can be added.

## Migration Plan

- No existing data to migrate (new collection)
- Register `CharactersModule` in `AppModule`
- No breaking changes to existing endpoints
- Deploy is non-destructive; rollback simply removes the module registration
