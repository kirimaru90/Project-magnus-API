## Context

Both fixes live entirely in
[terminals.service.ts](../../../api/src/terminals/terminals.service.ts).

**Fix 1 — Node graph integrity:**
`create()` and `update()` currently pass `dto.nodes` straight to `contentWithoutUsers()`
and then to the DB with no structural check. The authoring guide documents `choices[].target`
as required to be a real node id, but also acknowledges that the API never enforced this.
The `harden-terminal-input-validation` change explicitly parked node validation. This change
lifts the deferral for the one unambiguous rule: `target` must resolve within the same
`nodes` object.

**Fix 2 — Login block in playback responses:**
`contentWithoutUsers()` stores `login: { users: [{username}] }` (usernames only, passwords
stripped). `stripContent()` then replaces `users` with `[]` on every read path. The net
effect is that `load` and `loadByHiddenId` return `content.login.users: []` for terminals
with fictional users — the list the frontend needs to populate a login dropdown is gone.
For terminals without users, `login` is absent. The two cases have inconsistent shapes
and neither is useful.

## Goals / Non-Goals

**Goals:**
- Reject create/import/update when any `choices[].target` (including within `variants`) is
  not a key in the same `nodes` map; HTTP 400 with all dangling targets named.
- Playback responses (`load`, `loadByHiddenId`) return `content.login.users` as an array
  of `{username}` objects when fictional users exist, and omit `login` entirely when they
  do not.

**Non-Goals:**
- Validating other node internals (`when` conditions, `set` mutations, component shapes) —
  these remain free-form per prior decision.
- Requiring a `start` key in `nodes` (not in scope for this change).
- Changing `GET /terminals/:id` (detail) — its `login`-stripping behavior is already
  handled separately: admins see full credentials via the `fictionalUsers` query; non-admins
  get the same `stripContent` output, which is fine because they don't need the list).
- Retroactively re-validating stored terminals.

## Decisions

### 1. Pure in-memory `validateNodeGraph()` helper

**Decision:** Add a private static helper `validateNodeGraph(nodes: Record<string, unknown>): void`
in `TerminalsService`. It iterates `Object.entries(nodes)`, drills into each node's
`choices` array (and into `variants[].choices` for variant-style nodes), collects every
`target` string, deduplicates, and throws `BadRequestException` with a message listing all
targets not found in `Object.keys(nodes)`.

```
validateNodeGraph(nodes):
  targets = []
  for each node in nodes.values():
    for each choice in (node.choices ?? []):
      if choice.target is string → push choice.target
    for each variant in (node.variants ?? []):
      for each choice in (variant.choices ?? []):
        if choice.target is string → push choice.target
  dangling = targets.filter(t => !(t in nodes))  [deduped]
  if dangling.length > 0:
    throw BadRequestException(`nodes contains dangling choice targets: ${dangling.join(', ')}`)
```

**Where called:** At the top of `create()` and `update()`, before `contentWithoutUsers()`
and before any DB interaction. Import goes through `create()`, so it is covered.

**Why not a DTO decorator?** The `nodes` field is typed `Record<string, unknown>` and is
intentionally free-form. A service-layer check keeps the DTO clean and avoids the
class-transformer difficulties already documented in the prior hardening change.

### 2. Fix `stripContent()` — pass usernames through, drop empty login

**Decision:** Change `stripContent()` from "replace users with `[]`" to "if the stored
`users` list is non-empty, keep it as-is; otherwise delete the `login` key."

```typescript
// Before
stripped.login = { ...(stripped.login), users: [] };

// After
const users = (stripped.login as any).users;
if (Array.isArray(users) && users.length > 0) {
  // passwords were already removed at write time — username list is safe to forward
} else {
  delete stripped.login;
}
```

Because `contentWithoutUsers()` stores only `{username}` objects (no `password` field),
no password can leak through this path.

### 3. Guard `contentWithoutUsers()` for empty login

**Decision:** Change the `if (dto.login)` guard to `if (dto.login?.users?.length)`. This
prevents storing `login: { users: [] }` when a DTO carries an empty `LoginBlockDto`.
Keeps the stored content clean and makes `stripContent()`'s output predictable.

## Risks / Trade-offs

- **[Existing terminals with dangling targets are not re-checked]** → Only new writes
  are validated. Authoring tools that produce bad terminals will now get a 400; existing
  bad data is not cleaned up. Acceptable: the change is strictly additive on the write
  path and read paths are unchanged.
- **[Frontend now receives usernames in `content.login.users`]** → Any frontend code
  that currently reads `content.login.users` and expects `[]` will now see actual
  usernames. This is a corrective behavior change; frontends should already be designed
  to use this list for the login dropdown.
- **[`stripContent` is also called from `detail` via non-admin path]** → The
  `detail()` method uses `stripContent()` for non-admin callers. After this fix,
  non-admin `GET /terminals/:id` will also forward usernames. This is consistent and
  correct — the same data the frontend needs on `load` is needed on `detail` too.
  Admin calls bypass `stripContent` entirely (they get raw `fictionalUsers` from the DB).

## Migration Plan

No data migration. Changes are write-validation + read-serialization only. Rollback is
a straight revert with no state to unwind.
