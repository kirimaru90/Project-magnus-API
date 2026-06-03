## Why

The MAGNUS API powers a Pip-Boy-style TTRPG webapp. Players need a character sheet accessible via the API — storing identity, stats, inventory, and live session state. Without a character module the frontend has no persistence layer for character data.

## What Changes

- New `characters` resource scoped under campaigns (`/campaigns/:cid/characters`)
- Players can own multiple characters per campaign; each character belongs to exactly one player and one campaign
- Full CRUD on character documents plus section-level `PATCH` endpoints that diff by element id (update by id, create on id-less, remove via `deletedIds`)
- Field-level write authorization: a deny-all whitelist limits which sections/fields a non-admin may change (e.g. SPECIAL, skills, perks are GM-only); unauthorized keys are silently discarded
- Soft-delete: characters are flagged `isDeleted` with a `deletedAt` timestamp rather than hard-removed
- Inventory split into two sub-resources: **items** (weapons, equip, consumables, other) and **resources** (caps, bobbleheads, scraps)

## Capabilities

### New Capabilities

- `characters`: Core CRUD for character documents scoped to a campaign, including ownership, access control, field-level write authorization, and soft-delete
- `character-stats`: Section-level `PATCH` endpoints for SPECIAL, skills, perks, status (conditions + criticalState), and action points, with id-based diffing
- `character-inventory`: Section-level `PATCH` endpoint for inventory items (weapons, equip, consumables, other), diffing each array by item id
- `character-resources`: Section-level `PATCH` endpoint for resource counters (caps, bobbleheads, scraps)

### Modified Capabilities

## Impact

- New NestJS module: `CharactersModule` registered in `AppModule`
- New Mongoose schema: `Character` with embedded sub-documents; collection elements (conditions, perks, inventory items) carry a persisted `id` (nanoid), skills carry a catalog-slug `id`
- New route group: `GET|POST /campaigns/:cid/characters`, `GET|PUT|DELETE /campaigns/:cid/characters/:id`, plus 7 section `PATCH` routes (each returning an envelope `{ section, ignored }` — the mutated section plus a list of any inputs the server dropped)
- Access control: players access own characters only; admins access all characters within a campaign they manage. A field-level whitelist further restricts which sections/fields non-admins may write
- No breaking changes to existing endpoints
