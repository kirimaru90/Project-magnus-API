# Campaigns & Terminals — API Call Input/Output

> **Note on "AI calls".** This codebase has **no AI/LLM integration** — there are no
> `openai`/`anthropic`/etc. dependencies and no model calls in `api/src`. The "AI"
> mentions in `reference/api_spec.md` only mean that document was *written for* an AI
> agent. This file therefore documents the **API calls** (HTTP request → response)
> for the `campaigns` and `terminals` modules, taken directly from the controllers,
> DTOs, schemas, and services.

## Conventions

- **Auth column:** `admin` = valid JWT with `role: admin`; `optional` = works
  anonymously or with a JWT, response/visibility varies by actor.
- All bodies are JSON. Path params shown as `:id` etc.
- Access guards return **404 (not 403)** when an actor cannot see a campaign/terminal,
  to avoid leaking existence.
- `state` has two different shapes depending on the endpoint:
  - **Declaration shape** (`StateEntry`): `{ type, value, default, values? }` — returned
    by campaign detail/list.
  - **Flat shape**: `{ varName: value }` — returned by all `/state*` endpoints and by
    terminal `load`/`detail`.

---

## Campaigns — `api/src/campaigns/campaigns.controller.ts`

### `GET /campaigns` — list (auth: optional)
- **Input:** none. Token optional.
- **Output:** array of campaign objects, filtered by visibility:
  - admin → all campaigns; player → public+active plus assigned; anonymous → public+active only.
- **Campaign object:**
  ```json
  {
    "id": "65f…",
    "name": "string",
    "isActive": false,
    "isPublic": false,
    "state": { "varName": { "type": "number", "value": 0, "default": 0, "values": ["..."] } },
    "createdAt": "2026-05-26T...",
    "updatedAt": "2026-05-26T...",
    "players": ["userId", "..."]
  }
  ```
  `players` is populated **only for admin**; non-admins receive `[]`.

### `POST /campaigns` — create (auth: admin)
- **Input** (`CreateCampaignDto`):
  ```json
  { "name": "string (required, min 1)", "isActive": false, "isPublic": false }
  ```
  `isActive`/`isPublic` optional, default `false`.
- **Output:** the created campaign object (admin shape, `state: {}`, `players: []`).

### `GET /campaigns/:id` — detail (auth: optional + access guard)
- **Input:** none.
- **Output:** single campaign object (same shape as list). 404 if not visible.

### `PUT /campaigns/:id` — update (auth: admin)
- **Input** (`UpdateCampaignDto`, all optional): `{ "name?", "isActive?", "isPublic?" }`.
- **Output:** updated campaign object (admin shape). 404 if not found.

### `DELETE /campaigns/:id` — delete + cascade (auth: admin)
- **Input:** none.
- **Output:** **204 No Content**. Cascade-deletes the campaign's terminals and their
  fictional users. Additionally, on every user document: sets `lastCampaignId` to `null`
  if it references this campaign, and removes the per-campaign entry from
  `unlockedHiddenIds`.

### `POST /campaigns/:id/activate` — toggle `isActive` (auth: admin)
- **Input:** none.
- **Output:** updated campaign object with `isActive` flipped.

### `GET /campaigns/:id/players` — list players (auth: admin)
- **Input:** none.
- **Output:** array of `{ "id", "username", "role" }`.

### `POST /campaigns/:id/players` — assign player (auth: admin)
- **Input** (`AddPlayerDto`): `{ "playerId": "userId" }`.
- **Output:** `{ "id", "username", "role" }` of the added user.
- **Errors:** 400 invalid id / non-player role; 404 user or campaign not found.

### `DELETE /campaigns/:id/players/:playerId` — remove player (auth: admin)
- **Input:** none.
- **Output:** **204 No Content**.

---

## Campaign global state — `api/src/campaigns/campaign-state.controller.ts`

Global state variables are **declared** when terminal content is created/updated
(first-declaration-wins), not here. These endpoints read/mutate the `value`.

### `GET /campaigns/:id/state` (auth: optional + access guard)
- **Input:** none.
- **Output:** flat map `{ "varName": value, ... }`.

### `POST /campaigns/:id/state/mutate` (auth: optional + access guard)
- **Input** (`MutateStateDto`): mutations array; every key **must be `global.*`**.
  ```json
  {
    "mutations": [
      { "key": "global.alarm", "op": "set", "value": true },
      { "key": "global.score", "op": "increment", "by": 5 },
      { "key": "global.flag",  "op": "toggle" }
    ]
  }
  ```
  - `op: set` → requires `value` matching the declared type (`boolean`/`number`/`string`,
    or one of `values` for `enum`).
  - `op: increment` → requires `type:number`; `by` defaults to `1`.
  - `op: toggle` → requires `type:boolean`.
- **Output:** `{ "state": { "varName": value, ... } }` — the **complete** flat snapshot.
- **Errors (400):** wrong scope, `Undeclared variable: <name>`, or type mismatch.

### `POST /campaigns/:id/state/reset` (auth: admin)
- **Input:** none.
- **Output:** `{ "state": {flat} }`. **Destructive:** also resets every terminal in the
  campaign to its declared defaults.

### `POST /campaigns/:id/state/:key/reset` (auth: admin)
- **Input:** none. `:key` is the bare var name (no `global.` prefix).
- **Output:** `{ "state": {flat} }` after that one var is reset to its `default`.
- **Errors (400):** `Undeclared variable: <key>`.

---

## Terminals — `api/src/terminals/terminals.controller.ts`

### `GET /campaigns/:id/terminals` — list in campaign (auth: optional + access guard)
- **Input:** none.
- **Row visibility rules** (within an accessible campaign):
  - **Admin** → all terminals.
  - **Player** → terminals where `meta.public === true` OR the terminal's `meta.hiddenId`
    is in the player's `unlockedHiddenIds.<campaignId>` list.
  - **Anonymous** → terminals where `meta.public === true` only (treated as a player with
    no unlocks).
- **Output:** array of **terminal summaries**:
  ```json
  {
    "id": "65f…",
    "campaignId": "65f…",
    "title": "string",
    "isPublic": false,
    "viewCount": 0,
    "hiddenId": "optional-slug",
    "createdAt": "...",
    "updatedAt": "..."
  }
  ```
  `hiddenId` is present only when the terminal has `content.meta.hiddenId` set; omitted
  otherwise. This endpoint does **not** mutate any user-document field.

### `POST /campaigns/:id/terminals` — create (auth: admin)
### `POST /campaigns/:id/terminals/import` — import from JSON (auth: admin)
Both take the same body and call the same service path.
- **Input** (`TerminalContentDto`):
  ```json
  {
    "meta": {
      "title": "string (required)",
      "hiddenId": "optional slug",
      "public": false
      // meta.id is server-owned — MUST NOT be sent (rejected if present)
    },
    "state": {
      "local":  { "varName": { "type": "number|boolean|string|enum", "default": 0, "values": ["..."] } },
      "global": { "varName": { "type": "...", "default": ... } }
    },
    "login": { "users": [ { "username": "string", "password": "string" } ] },
    "nodes": { "...": { } }
  }
  ```
  - `state.local` is projected onto the terminal; `state.global` is merged onto the
    parent campaign (**first-declaration-wins** — existing globals are not overwritten).
  - `login.users` passwords are stored in a separate `FictionalUser` collection; the
    terminal `content.login.users` keeps usernames only.
- **Output:** the created **terminal summary** (see above).
- **Errors:** 409 `hiddenId "…" already exists in this campaign` (unique per campaign);
  404 campaign not found.

### `GET /campaigns/:id/terminals/by-hidden-id/:hiddenId` — resolve hidden terminal (auth: optional + access guard)
- **Input:** none. Only matches terminals where `meta.public !== true`.
- **Output:** **playback payload** (same as `GET /terminals/:id/load`):
  ```json
  {
    "content": { "meta": { ..., "id": "<terminalId>" }, "state": {...}, "login": { "users": [] }, "nodes": {...} },
    "localState":  { "varName": value },
    "globalState": { "varName": value }
  }
  ```
  Increments `viewCount` (admin views only count if `terminals.countAdminViews` is on).
- **Side-effects on success (200):**
  - For any authenticated caller (admin or player): `$set user.lastCampaignId = campaignId`.
  - For player callers only: `$addToSet user.unlockedHiddenIds.<campaignId>` ← `hiddenId`.
  - Anonymous callers trigger no user-document write.
- **Self-heal on 404:** if the caller is authenticated and their
  `unlockedHiddenIds.<campaignId>` contains the requested slug, it is `$pull`ed before
  the 404 is returned.

**Privacy gate (TerminalAccessGuard)** — all routes that carry `TerminalAccessGuard`
(`GET /terminals/:id`, `GET /terminals/:id/load`, `POST /terminals/:id/fictional-login`,
`GET /terminals/:id/state`, `POST /terminals/:id/state/mutate`) enforce, beyond
campaign-level access:
- **Admin** → always passes.
- **Public terminal** (`meta.public === true`) → any caller passes.
- **Non-public terminal** → caller must have the terminal's `hiddenId` in their
  `unlockedHiddenIds.<campaignId>`. Anonymous callers and players without the unlock
  receive **404** (same 404-over-403 convention). A non-public terminal with no
  `hiddenId` is admin-only.

### `GET /terminals/:id` — detail (auth: optional + access guard)
- **Input:** none.
- **Output:** terminal detail. `content` has login users stripped (`users: []`) and
  `meta.id` injected; `state` is the **flat** local value map:
  ```json
  {
    "id": "...", "campaignId": "...", "title": "...",
    "content": { "meta": { ..., "id": "<id>" }, "nodes": {...}, "login": { "users": [] } },
    "state": { "varName": value },
    "createdAt": "...", "updatedAt": "..."
  }
  ```
  **Admin only** additionally gets `fictionalUsers: [{ "username", "password" }]`.

### `PUT /terminals/:id` — update (auth: admin)
- **Input:** `TerminalContentDto` (same as create).
- **Behavior:** **additive** local-state projection (new vars added, existing values kept);
  global state still first-declaration-wins; fictional users are fully replaced.
- **Output:** updated **terminal summary**.
- **Errors:** 409 duplicate `hiddenId`; 404 not found.

### `DELETE /terminals/:id` — delete (auth: admin)
- **Input:** none.
- **Output:** **204 No Content**. Also deletes the terminal's fictional users. If the
  terminal had `content.meta.hiddenId`, additionally `$pull`s that slug from every
  user's `unlockedHiddenIds.<campaignId>`.

### `POST /terminals/:id/export` — export full JSON (auth: admin)
- **Input:** none.
- **Output:** the full `content` object **including** `login.users` with passwords;
  `meta.id` is removed and null `hiddenId` cleaned — i.e. a re-importable document.

### `GET /terminals/:id/load` — load for playback (auth: optional + access guard)
- **Input:** none.
- **Output:** playback payload `{ content, localState, globalState }` (see by-hidden-id
  above). Login users stripped, `meta.id` injected. Increments `viewCount`.
- **Side-effect:** for any authenticated caller (admin or player), `$set
  user.lastCampaignId = terminal.campaignId`. Anonymous callers trigger no write.

### `POST /terminals/:id/fictional-login` — validate fictional credentials (auth: optional + access guard)
- **Input** (`FictionalLoginDto`): `{ "username": "string", "password": "string" }`.
- **Output (200):** `{ "ok": true, "username": "..." }`.
- **Errors:** 401 `Invalid credentials` (unknown user or wrong password).

---

## Terminal local state — `api/src/terminals/terminals.controller.ts`

### `GET /terminals/:id/state` (auth: optional + access guard)
- **Input:** none.
- **Output:** flat map `{ "varName": value }`.

### `POST /terminals/:id/state/mutate` (auth: optional + access guard)
- **Input** (`MutateStateDto`): same mutation language as campaign mutate, but every key
  **must be `local.*`**.
  ```json
  { "mutations": [ { "key": "local.access_count", "op": "increment", "by": 1 } ] }
  ```
- **Output:** `{ "state": { "varName": value } }` — full flat local snapshot.
- **Errors (400):** wrong scope, undeclared variable, type mismatch, terminal not found.

### `POST /terminals/:id/state/reset` (auth: admin)
- **Input:** none.
- **Output:** `{ "state": {flat} }` with all local vars reset to defaults.

### `POST /terminals/:id/state/:key/reset` (auth: admin)
- **Input:** none. `:key` is the bare var name (no `local.` prefix).
- **Output:** `{ "state": {flat} }` after that var is reset to its `default`.
- **Errors (400):** `Undeclared variable: <key>`.

---

## Mutation operation reference (shared by campaign + terminal state)

| `op`        | Required fields | Type constraint                      | Effect |
|-------------|-----------------|--------------------------------------|--------|
| `set`       | `value`         | value matches declared type / `enum` values | sets `value` |
| `increment` | `by` (opt, def 1) | declared `type:number`             | adds `by` |
| `toggle`    | —               | declared `type:boolean`              | flips boolean |

Common errors (HTTP 400): `All mutations must use scope "<scope>"…`,
`Invalid key format: <key>`, `Undeclared variable: <name>`, and per-op type messages
(e.g. `set value must be number`, `increment requires type:number for key`).


---

## Schema-admin endpoints

The API also exposes two admin-only `PATCH` endpoints for evolving the state *schema*
(adding, updating, or deleting variables), distinct from the runtime mutation endpoints
above.

- `PATCH /campaigns/:id/state/schema` — modify the campaign global state schema
- `PATCH /terminals/:id/state/schema` — modify a terminal local state schema

Full payload specification, error body shapes (including the 409 `referencedBy` conflict
body), the cross-reference convention, and recommended backoffice UX are documented in
[**reference/state-schema-admin-sync.md**](./state-schema-admin-sync.md).
