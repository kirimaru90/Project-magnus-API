# Terminal API Specification

> **Audience.** This document is written for an AI agent (or developer) tasked with reworking
> the existing `reference/index.html` terminal client so it consumes the MAGNUS API
> defined in `reference/robco-terminal-architecture.md` and implemented under `api/`.
>
> **Scope.** Only the endpoints, payloads, flows, and behaviors the **Terminal** consumes.
> The Backoffice and admin surface are intentionally excluded. If an endpoint is not
> documented here, the Terminal must not call it.
>
> **Authority.** The API is the single source of truth. The Terminal performs best-effort
> client-side condition evaluation for rendering but never decides whether a state mutation
> is valid — that is the server's job. On API rejection, the Terminal must re-sync state
> and re-render.

---

## 1. Overview

The Terminal is a player-facing CRT UI that:

1. Boots straight into a campaign selection screen — no upfront login.
2. Lets the user optionally log in as a real user (player role) to access assigned campaigns
   in addition to active+public ones.
3. Loads a selected terminal's content + state snapshot from the API.
4. Renders nodes (with conditional variants), accepts choices and input components, and
   pushes state mutations back to the API.
5. Validates fictional logins server-side via the API; never compares passwords client-side.

The Terminal must **preserve the existing CRT aesthetic** (phosphor, scan lines, typewriter,
sounds, keyboard navigation, PWA). The replacement is purely the data layer.

---

## 2. Base URL, Headers, and Transport

- **Base URL:** read from a single client-side configuration constant (e.g. `API_BASE_URL`).
  Default for local dev: `http://localhost:3000`. The Terminal MUST NOT hard-code paths
  to anything outside `${API_BASE_URL}`.
- **Content type:** all request and response bodies are `application/json; charset=utf-8`.
- **Auth header:** when a JWT is present in client storage, every request MUST include
  `Authorization: Bearer <accessToken>`. When no token is present, the header is omitted
  (the Terminal does NOT send `Authorization: Bearer null`).
- **CORS:** the API allows the Terminal origin via `CORS_ALLOWED_ORIGINS`. The Terminal
  has no special handling beyond standard `fetch`.
- **Token storage:** persist `accessToken` in `localStorage` (key suggestion:
  `magnus.accessToken`). On every app boot, read it and call `GET /auth/me` to verify;
  on 401, clear the token and proceed unauthenticated.

---

## 3. Authentication

### 3.1 Token model

- Single access token, JWT (HS256), 24 h expiry. No refresh tokens. No server-side
  revocation list — the Terminal cannot "log out" the token server-side; logout is
  a client-side discard.
- Claims include `sub` (user id), `role` (`admin` | `player`), `iat`, `exp`. The Terminal
  does not need to parse the JWT; treat it as opaque. Trust `GET /auth/me` for identity.

### 3.2 `POST /auth/login`

Real user login.

**Request**

```json
{ "username": "alice", "password": "p@ssw0rd" }
```

**Response 200**

```json
{ "accessToken": "eyJ…", "role": "player", "expiresIn": 86400 }
```

**Response 401** — invalid credentials. Body intentionally generic; the Terminal MUST
display a generic "credenziali non valide" message and MUST NOT distinguish "unknown
user" from "wrong password" in its UI.

**Note.** The Terminal targets the `player` role. A successful login with `role: "admin"`
is technically allowed but admins are not expected to use the Terminal; treat it the
same as a player login.

### 3.3 `POST /auth/logout`

Stateless. Always returns **204**, with or without a token. The Terminal MUST:

1. Send the request (for symmetry / future auditability).
2. Discard the locally stored `accessToken`.
3. Refetch `GET /campaigns` (now unauthenticated) to refresh the visible campaign list.

### 3.4 `GET /auth/me`

Authenticated session inspection.

**Request** — bearer token required.

**Response 200**

```json
{
  "id": "65f…",
  "username": "alice",
  "role": "player",
  "lastCampaignId": "65f…",
  "unlockedHiddenIds": { "65f…": ["vault-101", "back-door"] }
}
```

- `lastCampaignId` — string id of the campaign the user most recently entered a terminal
  in, or `null`. Updated by `GET /terminals/:id/load` and
  `GET /campaigns/:id/terminals/by-hidden-id/:hiddenId` on success.
  **Lazy self-heal:** if the referenced campaign no longer exists, the server sets the
  field to `null` before responding (and persists the change).
- `unlockedHiddenIds` — plain object keyed by campaign id, values are arrays of
  `hiddenId` slugs the player has unlocked via the by-hidden-id route. Empty map
  serializes as `{}`. Never `null`. Admin callers will always see `{}` here (admins do
  not accumulate unlocks). This field is **not** mutated by this endpoint.

**Response 401** — missing, invalid, expired, or tampered token. The Terminal MUST treat
401 here as "session ended": clear the stored token and fall back to the unauthenticated
view (active+public campaigns only).

---

## 4. Campaign Discovery

### 4.1 `GET /campaigns`

Lists campaigns visible to the caller. **Actor-dependent**:

| Actor                     | Campaigns returned                                       |
| ------------------------- | -------------------------------------------------------- |
| Anonymous (no token)      | `isActive == true && isPublic == true`                   |
| Authenticated player      | public-active **plus** every campaign in their `players` |
| Authenticated admin       | all campaigns                                            |

**Response 200**

```json
[
  { "id": "65f…", "name": "Wasteland", "isActive": true, "isPublic": true }
]
```

**Terminal behavior:**

- Call this on boot (no token if none stored).
- After a successful login, call it again to refresh the list (the player's assigned
  campaigns will now appear).
- After logout, call it again to drop assigned-only campaigns.
- If the response is empty: render the "Nessuna campagna disponibile" state.
- If the response has exactly one campaign: enter it directly (skip the selection screen).
- If multiple: render the selection screen, preserving the CRT aesthetic of the existing
  manifest list.

### 4.2 `GET /campaigns/:id/terminals`

Lists terminals belonging to a campaign. Access rules mirror campaign visibility:
admin sees all; player sees if assigned or public-active; anonymous sees only if
public-active. A campaign the caller cannot access returns **404** (not 403) so that
existence is not leaked.

**Response 200**

```json
[
  {
    "id": "660…",
    "campaignId": "65f…",
    "title": "Super-Duper Mart - Terminale Amministrativo",
    "isPublic": true,
    "createdAt": "2026-05-15T10:00:00.000Z",
    "updatedAt": "2026-05-16T12:00:00.000Z"
  }
]
```

`isPublic` here reflects the terminal's `meta.public` flag inside its content — it is
the per-terminal visibility flag that replaces the old `dati/manifest.json`
public/hidden split.

**Terminal behavior:**

- Render terminals with `isPublic === true` as visible buttons.
- Render an "INSERISCI NOME ARCHIVIO" input as the entry point for hidden terminals
  (`isPublic === false`). The user types a free-form slug (`hiddenId`) and the Terminal
  calls `GET /campaigns/:id/terminals/by-hidden-id/:hiddenId` to resolve it. If the
  endpoint returns 404, show the "ARCHIVIO NON TROVATO" error.
- The by-hidden-id endpoint resolves `content.meta.hiddenId` to a playable terminal
  payload. It only matches non-public terminals (a match with `meta.public === true`
  returns 404). The response payload is the same shape as `GET /terminals/:id/load`
  (`{ content, localState, globalState }`).

### 4.3 `GET /campaigns/:id` *(optional for the Terminal)*

The Terminal does not require this endpoint for the basic flow — the data from
`GET /campaigns` is sufficient for the selection screen. It is documented here only
so the agent knows it exists if a richer campaign-detail view is added later.
Response shape: `{ id, name, isActive, isPublic, players, state, createdAt, updatedAt }`,
with `players` projected as `[]` for non-admin callers.

---

## 5. Terminal Playback

### 5.1 `GET /terminals/:id/load`

The single endpoint the Terminal uses to start a playback session. Returns the terminal
content plus the current state snapshot for both scopes.

**Response 200**

```json
{
  "content": {
    "meta": {
      "title": "...",
      "public": true,
      "hiddenId": "super-duper-admin",
      "id": "660abc…"
    },
    "state": {
      "local":  { "bunker_code_seen": { "type": "boolean", "default": false } },
      "global": { "omega_activated":  { "type": "boolean", "default": false } }
    },
    "login": { "users": [] },
    "nodes": { "start": { "text": "...", "choices": [ … ] } }
  },
  "localState":  { "bunker_code_seen": false, "access_count": 0 },
  "globalState": { "omega_activated": false }
}
```

**Critical guarantees and constraints:**

- `content.login.users` is **always `[]`** in this response. Fictional passwords are
  never delivered. The Terminal must never attempt to compare passwords locally —
  all fictional login goes through `POST /terminals/:id/fictional-login` (§7).
- `localState` and `globalState` are **flat** `{ key: value }` maps — the schema
  metadata lives under `content.state.local|global`, but the runtime values are
  flat. Keep these two structures in sync in the Terminal's in-memory model.
- `content.meta.hiddenId` is the human-authored slug used for non-public terminal
  lookup (see §4.2). It is the only writable identifier in `content.meta`, and it
  is **optional** — terminals created without a slug are valid and simply cannot
  be resolved through `GET /campaigns/:id/terminals/by-hidden-id/:hiddenId`. The
  per-campaign uniqueness constraint on `hiddenId` is enforced by a **partial**
  unique index that applies only to documents where `content.meta.hiddenId` is a
  string; multiple terminals without a `hiddenId` may coexist in the same campaign.
- `content.meta.id` is a **read-only injected mirror** of the top-level terminal
  `id` (the Mongo `_id`). It is not stored — the server adds it on every read
  (`GET /terminals/:id`, `GET /terminals/:id/load`, by-hidden-id lookup). Clients
  MUST NOT send `meta.id` on create/update/import — doing so returns HTTP 400.
  The admin-only `POST /terminals/:id/export` endpoint strips the injected
  `meta.id` so the exported JSON contains `content.meta = { title, hiddenId, public? }`
  and re-imports cleanly.
- Always start playback at the `start` node. Per-player progress is not tracked;
  there is no "resume."

**404** — terminal does not exist, or the caller cannot access its campaign (e.g.
anonymous load on a private campaign). The Terminal must treat both identically:
show "ARCHIVIO NON TROVATO".

### 5.2 Content schema reference

The shape of `content` (nodes, choices, variants, components, conditions, mutations)
is defined in [robco-terminal-architecture.md §"Terminal Content Schema"](robco-terminal-architecture.md)
and §"Condition Syntax". The Terminal MUST implement client-side evaluation of those
conditions exactly as specified there. This document does not duplicate that schema;
treat the architecture doc as authoritative for content structure.

### 5.3 Node rendering cycle

For every node entered, the Terminal follows this sequence. The ordering is pinned —
do not reorder steps:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  1. SELECT VARIANT                                                           │
│     If node.variants exists, evaluate each `when` against the current        │
│     in-memory state snapshot. Pick the first match; fall back to             │
│     {default: true}. The selected variant supplies text / choices /          │
│     components for the rest of the cycle.                                    │
├──────────────────────────────────────────────────────────────────────────────┤
│  2. RENDER                                                                   │
│     Run the existing typewriter render on the selected text. Preserve CRT    │
│     aesthetic, typing sound, skip-on-keypress behavior.                      │
├──────────────────────────────────────────────────────────────────────────────┤
│  3. APPLY on_enter (render-then-mutate)                                      │
│     If the node defines `on_enter`, POST those mutations AFTER render        │
│     starts (fire-and-await — do not block the typewriter on the round-trip). │
│     Replace the in-memory state with the snapshot returned by the API        │
│     (§6.4). Errors → log + refetch state via GET /load and re-render.        │
│                                                                              │
│     Rationale: rendering is immediate visual feedback. on_enter effects      │
│     are about state side-effects for subsequent nodes, not the current one.  │
├──────────────────────────────────────────────────────────────────────────────┤
│  4. SHOW CHOICES                                                             │
│     After the typewriter completes, filter `choices` by their `when`         │
│     predicates (if any) against the latest state snapshot. Render the        │
│     remaining choices plus the existing "[ Torna al menu precedente ]"      │
│     and "[ disconnetti terminale ]" navigation buttons.                      │
├──────────────────────────────────────────────────────────────────────────────┤
│  5. ON CHOICE SELECTED                                                       │
│     If the choice has `set` mutations: POST them FIRST and AWAIT the         │
│     response (§6.3). Only navigate to `choice.target` after the API has      │
│     confirmed the mutation. On error, surface a generic terminal-style       │
│     error and stay on the current node.                                      │
│                                                                              │
│     This is the opposite of step 3: choice effects are preconditions for     │
│     the next node and must be confirmed before navigation.                   │
├──────────────────────────────────────────────────────────────────────────────┤
│  6. ON INPUT COMPONENT SUBMITTED                                             │
│     POST a mutation that `set`s the input value into `set` (target key).     │
│     AWAIT the response. Then evaluate the component's `branches` against     │
│     the updated state and navigate to the matching target (or `default`).    │
└──────────────────────────────────────────────────────────────────────────────┘
```

**State snapshot model.** Maintain two flat maps in memory:
`local` (per terminal) and `global` (per campaign). Every successful mutation response
includes the new snapshot for the affected scope — replace the corresponding map
wholesale; do not merge-patch keys.

---

## 6. State Mutations

### 6.1 Key syntax and scope routing

Keys in mutations and conditions are always prefixed `local.` or `global.`. The
Terminal routes mutations to the correct endpoint based on the prefix:

| Key prefix | Endpoint                                |
| ---------- | --------------------------------------- |
| `local.*`  | `POST /terminals/:id/state/mutate`      |
| `global.*` | `POST /campaigns/:id/state/mutate`      |

**Cross-scope batches are rejected with 400.** If a single source array (e.g. a
choice's `set` block) contains both `local.x` and `global.y`, the Terminal MUST
issue **two** sequential requests — one per scope — in the order they appear in
the source array. Both must succeed before navigating.

### 6.2 Mutation operators

| `op`        | Required field | Allowed variable types | Notes                          |
| ----------- | -------------- | ---------------------- | ------------------------------ |
| `set`       | `value`        | matching declared type | enum values must be in `values` |
| `increment` | `by` (number)  | `number`               | negative values allowed        |
| `toggle`    | —              | `boolean`              |                                |

Server-side validation will reject:
- a mutation against an undeclared variable (400),
- a type mismatch (400),
- an enum value not in the declared list (400),
- an `increment` on a non-number (400),
- a `toggle` on a non-boolean (400).

The Terminal performs no semantic validation — let the server reject. On 400,
refetch state via `GET /terminals/:id/load` and re-render; this is a
content-authoring bug, not a player issue.

### 6.3 Request / response shape

**Request**

```json
{
  "mutations": [
    { "key": "local.access_count", "op": "increment", "by": 1 },
    { "key": "local.bunker_code_seen", "op": "set", "value": true }
  ]
}
```

**Response 200**

```json
{
  "state": {
    "access_count": 1,
    "bunker_code_seen": true,
    "sullivan_mood": "calm"
  }
}
```

The response always contains the **complete** snapshot of the affected scope, not
just the mutated keys. Replace the in-memory map wholesale.

### 6.4 Atomicity

All mutations in a single request apply atomically (single Mongo `updateOne` per
the API's design — see [design.md D6](../openspec/changes/archive/2026-05-15-bootstrap-terminal-api/design.md)).
The Terminal can safely send a batched array knowing either all apply or none do.
Do NOT split a single source array into per-mutation requests just to "be safe"
— that defeats the atomicity guarantee.

### 6.5 Anonymous mutations

State mutations on **active + public** campaigns are accepted from **unauthenticated**
callers by explicit product decision. The Terminal does not need to gate
state-mutation calls on having a token. It is the API's job to refuse mutations
on private campaigns (it returns 404 there to avoid leaking existence).

---

## 7. Fictional Login

### 7.1 `POST /terminals/:id/fictional-login`

Validates a fictional-user credential (the narrative-puzzle password gating a node
or terminal). Accessible to any caller who can read the terminal.

**Request**

```json
{ "username": "Re_Del_Cram", "password": "58874645" }
```

**Response 200** — `{ "ok": true, "username": "Re_Del_Cram" }`

**Response 401** — generic failure. The Terminal MUST show a generic
"CREDENZIALI NON VALIDE" error and MUST NOT distinguish unknown-user from
wrong-password.

### 7.2 Session model

Once a fictional user is successfully authenticated within a Terminal session,
the Terminal records `{ terminalId, username }` in an in-memory set (the
existing `loggedInUsers` Map can be reshaped for this). For the remainder of
the session, any node whose `login.users` includes that username is treated
as unlocked: render directly, do not re-prompt.

This state is **NOT** persisted server-side. Reloading the page or navigating
to a different terminal resets it. There is no API endpoint to "remember" a
fictional login.

### 7.3 When to call

The Terminal triggers the fictional-login UI when:

1. The loaded terminal's root `content.login` block is non-empty and no
   username in that block has been authenticated this session — present the
   login screen before rendering the `start` node.
2. A target node has a per-node `login` block — same logic, but localized
   to that node entry.

In both cases, on success, proceed to the node's rendering cycle (§5.3).

---

## 8. Error Reference

The Terminal must handle the following responses across all endpoints. Anything
not in this table is unexpected — log and surface a generic CRT-styled error.

| Status | When                                                          | Terminal behavior                                                                                              |
| ------ | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 200    | Success                                                       | Use response body. Replace in-memory state from `state` field if present.                                       |
| 201    | Success (create) — not expected in the Terminal flow          | Treat as 200.                                                                                                  |
| 204    | Logout                                                        | Clear token client-side.                                                                                       |
| 400    | Validation error (bad mutation, malformed payload)            | Refetch state via `GET /terminals/:id/load` and re-render. Show generic error; do not expose API detail to user. |
| 401    | Missing / invalid / expired / tampered token                  | Clear stored token. Drop back to unauthenticated view. If the user was mid-flow in an assigned campaign, return to campaign selection.                                                                                                              |
| 403    | Authenticated but lacks permission (admin route, etc.)        | Should not occur on Terminal-allowed routes. If it does: treat as 404 (do not leak meaning) and return to campaign selection.                                                                                                                       |
| 404    | Resource does not exist OR caller cannot access it            | Show "ARCHIVIO NON TROVATO" or "CAMPAGNA NON DISPONIBILE" depending on context. Never assume the resource exists — 404 deliberately conflates both cases.                                                                                            |
| 5xx    | Server error                                                  | Show generic "ERRORE DI RETE" with a "[ Torna al menu ]" option, mirroring the existing `initBoot` error branch. |

**Important.** The API intentionally returns **404** rather than 403 for unauthorized
campaign / terminal access. The Terminal MUST NOT use the difference between 403 and
404 to infer existence.

---

## 9. PWA and Caching Rules

The existing service worker (`sw.js`) caches static assets aggressively. The
new data layer must NOT cache authenticated or per-session content.

- **Static shell** (HTML/CSS/JS/icons/sounds): cache normally (cache-first or
  stale-while-revalidate, as today).
- **`GET /campaigns` (no auth)**, **`GET /campaigns/:id/terminals`** for public
  campaigns, **`GET /terminals/:id/load`** for terminals in public campaigns:
  may be cached **only as network-first with a short TTL** (suggested 60 s).
  Do not serve cached data when offline if the user is authenticated —
  cached responses leak the previous session.
- **Any request that included an `Authorization` header**: MUST NOT be cached
  by the service worker. Use `cache: 'no-store'` on the `fetch` call when
  the token is attached, or filter in the SW's `fetch` handler.
- **`POST` / `PUT` / `DELETE`**: never cache. The SW must let mutation requests
  pass through to the network.

If implementing offline support for public campaigns is desired later, gate it
on a check of `Authorization` header presence and the campaign's `isPublic`
flag in the response. For the initial rework, "online-only" is acceptable.

---

## 10. Boot Flow Summary

A single annotated state diagram of the Terminal's high-level flow. Use this
as a checklist while reworking `reference/index.html`:

```
                       ┌──────────────────────┐
                       │   App boot           │
                       │ - read localStorage  │
                       │   (accessToken?)     │
                       └──────────┬───────────┘
                                  │
                  ┌───────────────┴───────────────┐
                  │                               │
              token present                 no token
                  │                               │
        GET /auth/me                              │
        ┌─────────┴────────┐                      │
       200                401                     │
        │                  │                      │
        │           clear token                   │
        │                  │                      │
        └─────────┬────────┴──────────────────────┘
                  │
        GET /campaigns  (with bearer if token, otherwise anonymous)
                  │
        ┌─────────┴─────────┐
        │  zero  one  many  │
        │   │     │    │    │
        │   v     v    v    │
        │  "no   enter select
        │  data" directly screen
        │   │     │    │    │
        └───────────────────┘
                  │
                  v
        GET /campaigns/:id/terminals
                  │
        Render visible (isPublic) terminals
        + hidden-id input
                  │
                  v
        GET /terminals/:id/load
        (handle 404 as "not found")
                  │
        ┌─────────┴─────────┐
        │ content.login?    │
        │  yes → login UI   │  (POST /terminals/:id/fictional-login)
        │  no  → start node │
        └─────────┬─────────┘
                  │
                  v
        Node rendering cycle (§5.3)
        loop: select variant → render →
              fire on_enter → show choices →
              on choice: POST set, navigate
              on input:  POST set, branch
                  │
        [ disconnetti terminale ] → return to campaign list
        [ Esci ] (if authenticated) → POST /auth/logout, clear token,
                                      refetch GET /campaigns
        [ Accedi ] (if anonymous)  → POST /auth/login, store token,
                                      refetch GET /campaigns
```

---

## 11. Endpoint Quick Reference

The complete Terminal-visible API surface, in dependency order:

| #  | Method | Path                                                | Auth          | Purpose                                |
| -- | ------ | --------------------------------------------------- | ------------- | -------------------------------------- |
| 1  | POST   | `/auth/login`                                       | none          | Real-user login → JWT                  |
| 2  | POST   | `/auth/logout`                                      | optional      | Stateless 204                          |
| 3  | GET    | `/auth/me`                                          | required      | Session inspection                      |
| 4  | GET    | `/campaigns`                                        | optional      | List campaigns (actor-dependent)        |
| 5  | GET    | `/campaigns/:id/terminals`                          | optional      | List terminals in a campaign            |
| 6  | GET    | `/campaigns/:id/terminals/by-hidden-id/:hiddenId`   | optional      | Resolve hidden terminal by slug         |
| 7  | GET    | `/terminals/:id/load`                               | optional      | Content + state snapshot                |
| 8  | POST   | `/terminals/:id/state/mutate`                       | optional      | Mutate local state                     |
| 9  | POST   | `/campaigns/:id/state/mutate`                       | optional      | Mutate global state                    |
| 10 | POST   | `/terminals/:id/fictional-login`                    | optional      | Validate narrative credentials          |

"optional" means: the route accepts both authenticated and anonymous calls;
visibility/permission is enforced inside the route based on campaign rules.
The Terminal sends the bearer header **when a token is stored**, and omits
it otherwise.

Any path not in this table is **out of scope** for the Terminal.
