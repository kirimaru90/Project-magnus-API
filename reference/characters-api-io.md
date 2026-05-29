# Characters — API Call Input/Output

> Contract for CMS and frontend development. Taken directly from
> [characters.controller.ts](../api/src/characters/characters.controller.ts),
> the DTOs in [api/src/characters/dto/](../api/src/characters/dto/), the
> [character.schema.ts](../api/src/characters/schemas/character.schema.ts),
> and [characters.service.ts](../api/src/characters/characters.service.ts).

## Conventions

- **Base path:** every endpoint is scoped under a campaign:
  `/campaigns/:campaignId/characters[...]`.
- **Auth:** all endpoints require a valid JWT (`Authorization: Bearer <token>`).
  Two roles exist:
  - `admin` — full access to every character in any campaign they can see.
  - `player` — can only see / mutate **their own** characters in campaigns
    they are a member of.
- **Guards in order:**
  1. `JwtRequiredGuard` — rejects unauthenticated requests with **401**.
  2. `CampaignAccessGuard` — **404** if the actor cannot see the campaign.
  3. `CharacterOwnerGuard` (per-character routes only) — **404** if the
     character does not exist, is soft-deleted, or belongs to another player.
     Never **403**: existence is not leaked.
- **404 over 403** is the convention everywhere. An unowned character is
  indistinguishable from a non-existent one from the client's perspective.
- **Player write scrubbing.** Non-admins can `PUT` / `PATCH` any section, but
  fields they are not allowed to write are **silently dropped** server-side
  (no error). The whitelist:

  | Section         | Player-writable fields                       |
  | --------------- | -------------------------------------------- |
  | `special`       | _(none — admin-only)_                        |
  | `skills`        | _(none — admin-only)_                        |
  | `perks`         | _(none — admin-only)_                        |
  | `actionPoints`  | `paCurrent` only                             |
  | `resources`     | `caps`, `scraps` (not `bobbleheads`)         |
  | `status`        | full section                                 |
  | `inventory`     | full section                                 |
  | `name`, `species` (root) | both                                |

- **Collection ids.**
  - `perks`, `positiveConditions`, `negativeConditions`, every inventory
    array → element `id` is a **server-minted nanoid(8)**. Omit `id` to
    create; supply `id` to update or delete.
  - `skills` → element `id` is a **caller-supplied catalog slug** (e.g.
    `"lockpick"`). Posting an item without `id` returns **400**.
- **Section PATCH responses return only the mutated section**, not the full
  character. Use `GET /:characterId` to refetch the whole document if needed.
- All bodies are JSON.

---

## Character object (canonical response shape)

Returned by `GET /` (as array), `GET /:characterId`, `POST /`, and `PUT /:characterId`.

```jsonc
{
  "id": "65f...",                       // Mongo ObjectId, stringified
  "campaignId": "65f...",
  "userId": "65f...",                   // owner

  "name": "string",
  "species": "human",                   // "human" | "ghoul" | "super_mutant" | "robot"

  "special": {
    "strength": 1,                      // each 1–5
    "perception": 1,
    "endurance": 1,
    "charisma": 1,
    "intelligence": 1,
    "agility": 1,
    "luck": 1
  },

  "skills": [
    { "id": "lockpick", "level": "competent" } // level: "competent" | "expert" | "master"
  ],

  "actionPoints": {
    "paMax": 8,                         // optional, integer ≥ 0
    "paCurrent": 5,                     // optional, integer ≥ 0
    "paTrackedBy": "agility"            // "agility" | "endurance"
  },

  "status": {
    "positiveConditions": [
      {
        "id": "Vc3kQ1pZ",               // server-minted nanoid(8)
        "name": "Well Rested",
        "severity": "minor",            // "minor" | "major"
        "description": "optional text"
      }
    ],
    "negativeConditions": [ /* same shape */ ],
    "criticalState": false
  },

  "perks": [
    {
      "id": "Ab12Cd34",                 // server-minted nanoid(8)
      "name": "Lone Wanderer",
      "description": "optional",
      "icon": "optional"
    }
  ],

  "resources": {
    "caps": 0,
    "bobbleheads": 0,
    "scraps": 0
  },

  "inventory": {
    "weapons":     [ /* WeaponEquip item */ ],
    "equip":       [ /* WeaponEquip item */ ],
    "consumables": [ /* ConsumableGeneric item */ ],
    "other":       [ /* ConsumableGeneric item */ ]
  },

  "createdAt": "2026-05-26T...",
  "updatedAt": "2026-05-26T..."
}
```

### Inventory item shapes

**Weapon / Equip item** (`weapons`, `equip`):
```jsonc
{
  "id": "Ab12Cd34",        // server-minted nanoid(8), unique across inventory
  "name": "10mm Pistol",
  "tags": [
    { "name": "ranged", "type": "core", "damaged": false }  // type: "core" | "extra"
  ],
  "broken": false
}
```
> Tags are leaf objects (no id). A PATCH on a weapon/equip item replaces its
> `tags` array **wholesale** — there is no per-tag diff.

**Consumable / Generic item** (`consumables`, `other`):
```jsonc
{
  "id": "Ab12Cd34",        // server-minted nanoid(8), unique across inventory
  "name": "Stimpak",
  "description": "optional",
  "quantity": 3            // integer ≥ 0
}
```

---

## CRUD

### `GET /campaigns/:campaignId/characters` — list

- **Auth:** player or admin.
- **Input:** none.
- **Output:** array of [Character objects](#character-object-canonical-response-shape).
  - **admin** → every non-deleted character in the campaign.
  - **player** → only their own non-deleted characters.

---

### `POST /campaigns/:campaignId/characters` — create

- **Auth:** player or admin.
- **Input** ([`CreateCharacterDto`](../api/src/characters/dto/create-character.dto.ts)):
  ```jsonc
  {
    "name": "string (required, min 1)",
    "species": "human",       // optional; defaults to "human" if omitted
    "userId": "65f..."        // REQUIRED for admin; IGNORED for player
  }
  ```
  - **player:** `userId` is forced to the actor; any value sent is dropped.
  - **admin:** `userId` is **required** (otherwise **400**), must be a valid
    ObjectId, and must belong to a campaign member (otherwise **400**).
- **Output:** the created [Character object](#character-object-canonical-response-shape).
  All numeric/collection sections come back at their default values
  (SPECIAL all `1`s, empty arrays, resources at `0`).
- **Errors:** `400` invalid userId / not a member; `404` campaign not found.

---

### `GET /campaigns/:campaignId/characters/:characterId` — detail

- **Auth:** owner or admin.
- **Input:** none.
- **Output:** the full [Character object](#character-object-canonical-response-shape).
- **Errors:** `404` if not found, soft-deleted, or unowned.

---

### `PUT /campaigns/:campaignId/characters/:characterId` — full update

- **Auth:** owner or admin (with player scrubbing).
- **Input** ([`UpdateCharacterDto`](../api/src/characters/dto/update-character.dto.ts)),
  all top-level fields optional. Sections **mirror the GET shape**, not the
  PATCH envelope:
  ```jsonc
  {
    "name": "string",
    "species": "ghoul",
    "special":      { /* same shape as response.special, partial merge */ },
    "skills":       [ { "id": "lockpick", "level": "expert" } ],   // REPLACES list
    "actionPoints": { "paMax": 8, "paCurrent": 5, "paTrackedBy": "agility" },
    "status": {
      "positiveConditions": [ /* direct array; REPLACES list */ ],
      "negativeConditions": [ /* direct array; REPLACES list */ ],
      "criticalState": false
    },
    "perks": [ /* direct array; REPLACES list */ ],
    "resources": { "caps": 0, "bobbleheads": 0, "scraps": 0 },     // partial merge
    "inventory": {
      "weapons":     [ /* direct array; REPLACES list */ ],
      "equip":       [ /* direct array; REPLACES list */ ],
      "consumables": [ /* direct array; REPLACES list */ ],
      "other":       [ /* direct array; REPLACES list */ ]
    }
  }
  ```
  **Semantics:**
  - `name`, `species`, `special`, `resources`, `actionPoints.*`,
    `status.criticalState` — partial merge (only fields present change).
  - `skills`, `perks`, each inventory array, each `status.*Conditions`
    array — full **replace** of that list. Elements **without `id`** get a
    server-minted nanoid(8). Skills still require their catalog slug `id`.
  - Player scrub: any field outside the [whitelist](#conventions) is silently
    stripped.
- **Output:** the updated [Character object](#character-object-canonical-response-shape).
- **Errors:** `400` validation; `404` not found / unowned.

---

### `DELETE /campaigns/:campaignId/characters/:characterId` — soft-delete

- **Auth:** owner or admin.
- **Input:** none.
- **Output:** **204 No Content** (no body). Sets `isDeleted: true` and
  `deletedAt`. The character disappears from list/detail responses.
- **Errors:** `404` not found / already deleted / unowned.

---

## Section PATCH endpoints

All section PATCH endpoints share these properties:

- Require **owner or admin** (with player scrubbing per the
  [whitelist](#conventions)).
- Return **only the mutated section**, not the whole character.
- nanoid-collection patches (perks, conditions, inventory) follow the
  **diff envelope** `{ items?, deletedIds? }`:
  - Removals from `deletedIds` apply first.
  - Then each `items[i]`:
    - has `id` and id is found → **shallow-merge** the supplied fields.
    - has `id` but id is unknown → **silently skipped** (no error).
    - has no `id` → **create**, server mints a nanoid(8).
- **Skill** patches use the same envelope but `id` is a catalog slug:
  - missing `id` → **400**.
  - `id` not present in the existing array → **insert** (catalog attach).
  - `id` already present → **merge** (e.g. level change).

---

### `PATCH /:characterId/special` — SPECIAL stats

- **Player-writable:** no fields (whole section dropped server-side).
- **Input** ([`PatchSpecialDto`](../api/src/characters/dto/patch-special.dto.ts)),
  partial merge, each field optional, **integer 1–5**:
  ```jsonc
  {
    "strength": 3,
    "perception": 4,
    "endurance": 2,
    "charisma": 1,
    "intelligence": 5,
    "agility": 3,
    "luck": 2
  }
  ```
- **Output:** the updated `special` object (full shape, all seven attributes).
- **Errors:** `400` validation; `404` not found / unowned.

---

### `PATCH /:characterId/skills` — skills

- **Player-writable:** no fields (whole section dropped server-side).
- **Input** ([`PatchSkillsDto`](../api/src/characters/dto/patch-skills.dto.ts)):
  ```jsonc
  {
    "items": [
      { "id": "lockpick", "level": "expert" },     // attach or update by slug
      { "id": "hacking",  "level": "master" }
    ],
    "deletedIds": ["barter"]                        // detach by slug
  }
  ```
  - `id` is required for every item (catalog slug). Omitting it → **400**.
  - `level` ∈ `"competent" | "expert" | "master"`.
- **Output:** the full updated `skills` array.

---

### `PATCH /:characterId/perks` — perks

- **Player-writable:** no fields (whole section dropped server-side).
- **Input** ([`PatchPerksDto`](../api/src/characters/dto/patch-perks.dto.ts)):
  ```jsonc
  {
    "items": [
      { "name": "Lone Wanderer", "description": "...", "icon": "..." },   // create
      { "id": "Ab12Cd34", "description": "updated text" }                  // update
    ],
    "deletedIds": ["Vc3kQ1pZ"]
  }
  ```
  - When creating (no `id`), `name` is **required**.
  - When updating (with `id`), supply only the fields you want to change.
- **Output:** the full updated `perks` array (each element with a server-minted `id`).

---

### `PATCH /:characterId/status` — conditions + criticalState

- **Player-writable:** entire section.
- **Input** ([`PatchStatusDto`](../api/src/characters/dto/patch-status.dto.ts)),
  every top-level field optional:
  ```jsonc
  {
    "positiveConditions": {
      "items": [
        { "name": "Well Rested", "severity": "minor", "description": "..." }, // create
        { "id": "Vc3kQ1pZ", "severity": "major" }                              // update
      ],
      "deletedIds": ["Ab12Cd34"]
    },
    "negativeConditions": { /* same envelope */ },
    "criticalState": true
  }
  ```
  - Condition `severity` ∈ `"minor" | "major"` (defaults to `"minor"` on create).
  - When creating (no `id`), `name` is **required**.
- **Output:** the full updated `status` object:
  ```jsonc
  {
    "positiveConditions": [ /* ... */ ],
    "negativeConditions": [ /* ... */ ],
    "criticalState": false
  }
  ```

---

### `PATCH /:characterId/action-points` — action points

- **Player-writable:** `paCurrent` only. `paMax` and `paTrackedBy` from a
  player are silently dropped.
- **Input** ([`PatchActionPointsDto`](../api/src/characters/dto/patch-action-points.dto.ts)),
  partial merge:
  ```jsonc
  {
    "paMax": 8,                  // integer ≥ 0, admin-only
    "paCurrent": 5,              // integer ≥ 0
    "paTrackedBy": "agility"     // "agility" | "endurance", admin-only
  }
  ```
- **Output:**
  ```jsonc
  { "paMax": 8, "paCurrent": 5, "paTrackedBy": "agility" }
  ```

---

### `PATCH /:characterId/inventory` — inventory items

- **Player-writable:** entire section.
- **Input** ([`PatchInventoryDto`](../api/src/characters/dto/patch-inventory.dto.ts)),
  each of the four buckets uses the diff envelope; omit a bucket to leave
  it untouched:
  ```jsonc
  {
    "weapons": {
      "items": [
        { "name": "10mm Pistol", "tags": [{ "name": "ranged", "type": "core" }] },   // create
        { "id": "Ab12Cd34", "broken": true }                                          // update
      ],
      "deletedIds": ["Vc3kQ1pZ"]
    },
    "equip":       { /* same shape as weapons */ },
    "consumables": {
      "items": [
        { "name": "Stimpak", "quantity": 3 },         // create
        { "id": "Ef56Gh78", "quantity": 5 }           // update
      ],
      "deletedIds": []
    },
    "other": { /* same shape as consumables */ }
  }
  ```
  - When creating (no `id`), `name` is **required** in every bucket.
  - `tags` on weapons/equip: if the field is present in an update item, the
    whole `tags` array is **replaced** (no per-tag diff).
  - `quantity` on consumables/other: integer ≥ 0.
  - Tag `type` ∈ `"core" | "extra"`; tag `damaged` defaults to `false`.
- **Output:** the full updated `inventory` object (all four buckets).

---

### `PATCH /:characterId/resources` — resource counters

- **Player-writable:** `caps`, `scraps`. `bobbleheads` from a player is
  silently dropped (admin-only counter).
- **Input** ([`PatchResourcesDto`](../api/src/characters/dto/patch-resources.dto.ts)),
  partial merge, each integer ≥ 0:
  ```jsonc
  { "caps": 250, "bobbleheads": 1, "scraps": 17 }
  ```
- **Output:**
  ```jsonc
  { "caps": 250, "bobbleheads": 1, "scraps": 17 }
  ```

---

## Quick reference

| Method | Path                                        | Auth         | Body                       | Returns                       |
| ------ | ------------------------------------------- | ------------ | -------------------------- | ----------------------------- |
| GET    | `/campaigns/:c/characters`                  | player/admin | —                          | Character[]                   |
| POST   | `/campaigns/:c/characters`                  | player/admin | `CreateCharacterDto`       | Character                     |
| GET    | `/campaigns/:c/characters/:id`              | owner/admin  | —                          | Character                     |
| PUT    | `/campaigns/:c/characters/:id`              | owner/admin  | `UpdateCharacterDto`       | Character                     |
| DELETE | `/campaigns/:c/characters/:id`              | owner/admin  | —                          | 204 No Content                |
| PATCH  | `/campaigns/:c/characters/:id/special`      | admin only*  | `PatchSpecialDto`          | `special`                     |
| PATCH  | `/campaigns/:c/characters/:id/skills`       | admin only*  | `PatchSkillsDto`           | `skills[]`                    |
| PATCH  | `/campaigns/:c/characters/:id/perks`        | admin only*  | `PatchPerksDto`            | `perks[]`                     |
| PATCH  | `/campaigns/:c/characters/:id/status`       | owner/admin  | `PatchStatusDto`           | `status`                      |
| PATCH  | `/campaigns/:c/characters/:id/action-points`| owner/admin* | `PatchActionPointsDto`     | `{paMax, paCurrent, paTrackedBy}` |
| PATCH  | `/campaigns/:c/characters/:id/inventory`    | owner/admin  | `PatchInventoryDto`        | `inventory`                   |
| PATCH  | `/campaigns/:c/characters/:id/resources`    | owner/admin* | `PatchResourcesDto`        | `resources`                   |

\* The endpoint is reachable by players, but their payload is field-scrubbed
to the [player whitelist](#conventions) — admin-only fields are silently
dropped. "admin only" rows have an empty whitelist, so a player request
will succeed (200) but mutate nothing.
