## Why

The terminal authoring guide ([reference/terminal-authoring-guide.md](../../../reference/terminal-authoring-guide.md))
documents rules the API is supposed to enforce, but several are not actually
checked at the right time. Malformed terminals pass create/import/update and
only fail later at playback, duplicate `hiddenId` values surface as unhandled
500s, and a couple of documented defaults are not applied. This change closes
the gaps so the code conforms to the guide as written — no new behavior, just
correct enforcement.

## What Changes

- **enum declarations must carry `values`.** When a state variable declares
  `"type": "enum"`, the `values` array becomes required and must be a non-empty
  array of strings. A missing or empty `values` is rejected with **HTTP 400** at
  create/import/update time instead of silently passing and failing later at
  mutation time. (Scope is narrow: presence/non-emptiness of `values` only — we
  do NOT validate that `default` is one of the values.)
- **duplicate `hiddenId` returns a clean error.** A `hiddenId` that collides
  with an existing terminal in the same campaign now returns **HTTP 409 Conflict**
  with a message naming the conflicting slug, instead of leaking a MongoDB
  duplicate-key error as a 500.
- **`increment` defaults `by` to 1.** A mutation `{ "op": "increment" }` with no
  `by` increments by 1, on both the terminal (local) and campaign (global)
  mutation paths.
- **state blocks are fully optional and default to empty.** Create/import/update
  accept terminals with no `state` key, or with only `state.local`, or only
  `state.global`. Any missing scope projects to an empty state map (`{}`), never
  `null` or an error. The same applies to campaign state projection.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `terminals`: enum `values` is required at validation time; duplicate
  `hiddenId` returns 409; absent/partial `state` blocks are accepted and
  projected to empty maps.
- `state-engine`: `increment` defaults `by` to 1 when omitted; state projection
  treats absent `local`/`global` scopes as empty.

## Impact

- **Code**
  - [api/src/terminals/dto/terminal-content.dto.ts](../../../api/src/terminals/dto/terminal-content.dto.ts) — conditional `values` validation on `StateVarDto`.
  - [api/src/terminals/terminals.service.ts](../../../api/src/terminals/terminals.service.ts) — catch duplicate-key error in `create()`/`update()` → 409; ensure `projectState()` tolerates absent/partial `state`.
  - [api/src/state/state.service.ts](../../../api/src/state/state.service.ts) — default `by` to 1 on increment for local and global paths; ensure empty-scope projection.
- **APIs** (behavior only, no signature changes)
  - `POST /campaigns/:id/terminals`, `POST /campaigns/:id/terminals/import`, `PUT /terminals/:id` — stricter enum validation, 409 on hiddenId conflict, accept missing state.
  - `POST /terminals/:id/state/mutate`, `POST /campaigns/:id/state/mutate` — increment default.
- **No documentation change.** [reference/terminal-authoring-guide.md](../../../reference/terminal-authoring-guide.md) already specifies all of this; the code is being brought into conformance.
- **No data migration.** Existing stored terminals are unaffected.
