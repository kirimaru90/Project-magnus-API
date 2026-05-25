# Frontend Integration — Campaigns & Terminal State Endpoints

All endpoints expect `Content-Type: application/json` and (when authenticated) `Authorization: Bearer <jwt>`.

## Access rules (apply everywhere below)

- **Admin** (`role: 'admin'`): full access to every endpoint.
- **Player** (`role: 'player'`): can access a campaign and its terminals only if `campaign.isActive === true` AND they are listed in `campaign.players`.
- **Anonymous** (no token): can access a campaign and its terminals only if `campaign.isActive && campaign.isPublic`.
- Endpoints labeled *(admin)* below return 403/404 to non-admins. Always include the bearer token when the user is logged in.

---

## Campaigns — `api/src/campaigns/campaigns.controller.ts`

### `GET /campaigns`
List campaigns visible to the actor. **No body.** Token optional (anonymous returns only public+active).

### `POST /campaigns` *(admin)*
Create a campaign.
```json
{
  "name": "string (required, min 1 char)",
  "isActive": false,
  "isPublic": false
}
```

### `GET /campaigns/:id`
Detail. **No body.**

### `PUT /campaigns/:id` *(admin)*
Update. All fields optional — send only what you change.
```json
{
  "name": "string",
  "isActive": true,
  "isPublic": false
}
```

### `DELETE /campaigns/:id` *(admin)*
Cascade delete. **No body.** Returns 204.

### `POST /campaigns/:id/activate` *(admin)*
Toggle `isActive`. **No body.**

### `GET /campaigns/:id/players` *(admin)*
**No body.**

### `POST /campaigns/:id/players` *(admin)*
Assign a player.
```json
{ "playerId": "<user _id>" }
```

### `DELETE /campaigns/:id/players/:playerId` *(admin)*
**No body.** Returns 204.

---

## Campaign global state — `api/src/campaigns/campaign-state.controller.ts`

The state is a flat `{ varName: value }` returned by `GET`. Mutations operate on **declared** variables only — declarations live on the campaign's `state` map (type + default), set at campaign-content time.

### `GET /campaigns/:id/state`
Returns flat `{ varName: value }`. **No body.**

### `POST /campaigns/:id/state/mutate`
**Scope rule:** every key must be prefixed `global.<varName>`. Sending `local.*` here is rejected.

**Request body:**
```json
{
  "mutations": [
    { "key": "global.<varName>", "op": "set | increment | toggle", "value": "<any>", "by": 1 }
  ]
}
```

Per-op rules (see `api/src/state/state.service.ts` lines 25–43):

| `op` | Required field | Type constraints |
|---|---|---|
| `set` | `value` | Must match the declared `type`: `boolean` → boolean, `number` → number, `string` → string, `enum` → one of the declared `values[]`. |
| `increment` | `by` (optional, defaults to `1`) | Variable must be declared as `type: number`. |
| `toggle` | — (omit `value` and `by`) | Variable must be declared as `type: boolean`. |

Examples:
```json
// set a number
{ "mutations": [{ "key": "global.score", "op": "set", "value": 42 }] }
```
```json
// increment by 5
{ "mutations": [{ "key": "global.score", "op": "increment", "by": 5 }] }
```
```json
// toggle a boolean
{ "mutations": [{ "key": "global.alarm_active", "op": "toggle" }] }
```
```json
// set an enum
{ "mutations": [{ "key": "global.phase", "op": "set", "value": "act_two" }] }
```
```json
// batch — all applied atomically in one Mongo update
{
  "mutations": [
    { "key": "global.score", "op": "increment", "by": 1 },
    { "key": "global.phase", "op": "set", "value": "act_two" }
  ]
}
```

Response: `{ "state": { ...flat map after mutation } }`.

### `POST /campaigns/:id/state/reset` *(admin)*
Resets every campaign variable to its declared `default`, AND resets every terminal in the campaign. **No body.**

### `POST /campaigns/:id/state/:key/reset` *(admin)*
Resets a single campaign variable. `:key` is the bare var name (no `global.` prefix). **No body.**

---

## Terminal local state — `api/src/terminals/terminals.controller.ts` lines 110–142

Same mutation language as campaigns, but **scope must be `local.`**.

### `GET /terminals/:id/state`
Flat `{ varName: value }`. **No body.**

### `POST /terminals/:id/state/mutate`
**Scope rule:** every key must be `local.<varName>`. Body shape and per-op rules are identical to the campaign mutate endpoint above.

```json
{
  "mutations": [
    { "key": "local.access_count", "op": "increment", "by": 1 },
    { "key": "local.is_locked",    "op": "toggle" },
    { "key": "local.last_user",    "op": "set", "value": "alice" }
  ]
}
```

Response: `{ "state": { ...flat map } }`.

Note: this route is gated by `TerminalAccessGuard`, so any user who can reach the terminal can mutate its local state — it is not admin-only.

### `POST /terminals/:id/state/reset` *(admin)*
Resets every local variable to its declared default. **No body.**

### `POST /terminals/:id/state/:key/reset` *(admin)*
Resets a single local variable. `:key` is the bare var name. **No body.**

---

## Error contract the frontend should handle

`POST .../state/mutate` returns `400 BadRequest` for any of these (messages from `api/src/state/state.service.ts`):

- `All mutations must use scope "global" / "local"` — wrong prefix for the endpoint.
- `Invalid key format: <key>` — missing the `<scope>.<var>` dot.
- `Undeclared variable: <name>` — the var isn't declared in the terminal/campaign content.
- `increment requires type:number for key` / `toggle requires type:boolean for key`.
- `set value must be boolean | number | string` / `set value must be one of: a, b, c` (enum).

A single bad item in `mutations` rejects the whole batch — no partial application.

---

## Practical client tips

1. Always `GET .../state` first (or use the terminal `load` endpoint) so the UI knows declared variables, types, enum values, and current values. The mutate endpoint won't tell you the schema.
2. Build a batch: collect all UI-driven changes into a single `mutations` array and send one `POST` — it's cheaper and avoids interim states.
3. The response always echoes the post-mutation flat state — use it to update your local store instead of re-fetching.
4. `toggle` must not carry `value` or `by`; some validators will pass it, but the value is ignored — leave it off to keep payloads clean.
5. Treat `state/reset` as destructive: the campaign-level reset also wipes every terminal in the campaign. Confirm in the UI before calling it.
