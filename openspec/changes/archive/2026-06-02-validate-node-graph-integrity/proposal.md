## Why

Two silent data-quality issues survive `create`/`import`/`update` and surface only at
runtime:

1. **Dangling `choices[].target` references.** The terminal authoring guide
   ([reference/terminal-authoring-guide.md](../../../reference/terminal-authoring-guide.md))
   states that a choice `target` _"must be a real node id"_, but the API stores
   `nodes` as free-form JSON with no referential-integrity check. A target key that
   does not exist in the same `nodes` map saves cleanly and causes a dead-end in the
   frontend at playback time — the player clicks a button and nothing happens.

2. **Vacuous `login` block in playback responses.** `stripContent()` (called by
   `load` and `loadByHiddenId`) defensively replaces `content.login.users` with `[]`
   even though passwords were already removed at write time by `contentWithoutUsers()`.
   The result is that the frontend receives `content.login.users: []` for every
   terminal that _ever had_ fictional users — an empty list that looks like the login
   system is present but broken. Conversely, when no users are stored, the `login`
   block is absent; the two cases are inconsistently shaped.

The previous hardening change (`harden-terminal-input-validation`) explicitly deferred
node-structure validation ("Validating nodes structure (intentionally free-form per the
guide)"). This change lifts that deferral for the one rule the guide unambiguously
enforces: every `choices[].target` must resolve within the same `nodes` map.

## What Changes

- **Node graph integrity check (HTTP 400 on broken references).** At create, import,
  and update time, scan all `choices[].target` values in the submitted `nodes` map —
  including choices nested inside `variants`. Any target key not present in `nodes` is
  rejected with HTTP 400, listing all dangling references. This is a pure in-memory
  check; no extra DB reads.

- **Login block cleanup in playback responses.** `stripContent()` is updated to pass
  the stored username list through unchanged (usernames are already password-free —
  `contentWithoutUsers()` strips passwords at write time) and to omit the `login` key
  entirely when the stored `users` list is empty. The frontend now reliably receives
  usernames when fictional login is active, and receives no `login` key when it is not.

- **`contentWithoutUsers()` guard.** Only store `login` in `content` when
  `dto.login.users` is non-empty; avoids persisting an empty-users block.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `terminals`: `choices[].target` values (and choices inside `variants`) are now
  validated at create/import/update time; dangling targets return HTTP 400. Playback
  responses (`load`, `loadByHiddenId`) include `content.login.users` with username
  objects when fictional users exist, and omit the `login` key entirely when they do
  not.

## Impact

- **Code**
  - [api/src/terminals/terminals.service.ts](../../../api/src/terminals/terminals.service.ts) —
    add `validateNodeGraph()` helper; call it in `create()` and `update()` before any
    DB write; fix `stripContent()` to pass usernames through and drop empty `login`
    blocks; fix `contentWithoutUsers()` guard.
- **APIs** (behavior only, no signature changes)
  - `POST /campaigns/:id/terminals`, `POST /campaigns/:id/terminals/import`,
    `PUT /terminals/:id` — new 400 on dangling `choices[].target`.
  - `GET /terminals/:id/load`, `GET /campaigns/:id/terminals/by-hidden-id/:hiddenId` —
    `content.login.users` now contains username objects (not `[]`) when fictional users
    are present; `login` key absent when no users.
- **Spec**
  - [openspec/specs/terminals/spec.md](../../../openspec/specs/terminals/spec.md) —
    add requirement for node graph integrity and update the playback login-block
    contract.
- **No data migration.** Existing stored terminals are not re-validated. The
  `stripContent` change is purely a serialization fix on read paths.
