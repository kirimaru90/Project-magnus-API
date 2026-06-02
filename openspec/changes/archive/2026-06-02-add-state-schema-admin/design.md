## Context

`StateService` currently exposes only **value** lifecycle operations (`mutate*`, `reset*`) over the `state` Maps on `Campaign` and `Terminal`. The variable set itself — names, types, defaults, enum members — is opaque to the API. Backoffice admins need an authoring surface to add / update / delete those variables in bulk.

A complicating factor: terminals reference campaign-level variables via `content.state.global.<varKey>` (per the project's existing content convention). Deleting or renaming a global variable while terminals still reference it would silently break gameplay logic. The schema-admin API must protect against that.

The two scopes are not symmetric:
- **Campaign (global) schema** → must consider cross-references from any terminal in the same campaign.
- **Terminal (local) schema** → no cross-references exist; campaigns never reference local vars, and terminals never reference each other's locals.

## Goals / Non-Goals

**Goals:**
- One PATCH per scope that can perform any mix of add/update/delete in a single atomic request (atomic at the campaign-document level; see Decision 6 for cross-document caveat on renames).
- Rename support that automatically rewrites referencing terminals.
- Protect global-variable deletes from breaking referencing terminals with a precise, actionable error.
- Reuse the existing `validateType` helper so that `default` / `value` on schema ops are validated identically to runtime mutations.
- Leave existing `mutate*` / `reset*` endpoints, DTOs, and response shapes untouched.

**Non-Goals:**
- Templated / string-token references (e.g., `{{global.x}}` in free text) are out of scope; only structured references at `content.state.global.<key>` are scanned.
- Cross-campaign references (no such concept exists).
- Schema versioning, migration history, audit log of schema edits.
- Optimistic concurrency (ETag / `If-Match`). Documented as a future concern; for backoffice low-write-rate use, last-write-wins is acceptable.
- Mongo transactions / multi-document atomicity. See Decision 6.
- A "force / override" flag for delete-with-references. Hard 409 only.

## Decisions

### Decision 1: PATCH with an explicit op list (vs PUT-replace)

Use `PATCH /<scope>/:id/state/schema` with `{ ops: [...] }`. Earlier exploration considered a declarative PUT-replace (send the whole desired schema). PATCH won because:
- Deletions and renames must be **explicit intents**, not derived from "this key is missing from the body." A backoffice form bug or partial save would otherwise silently delete variables.
- Renames require a distinct intent so the server can rewrite terminal references — a PUT diff cannot distinguish "rename foo→bar" from "delete foo, add bar," and the latter would block on referenced vars.

### Decision 2: Three actions — `add`, `update`, `delete`. Rename folded into `update`.

```jsonc
{ "action": "add",    "name": "alarm", "entry": {...}, "value"?: <typed> }
{ "action": "update", "name": "score", "rename"?: "tally", "entry": {...}, "value"?: <typed> }
{ "action": "delete", "name": "legacy" }
```

Considered keeping `rename` as a top-level action. Rejected: every rename in practice will also restate `entry` (otherwise why touch it?), and folding it in keeps the op list flatter. The optional `rename` field on `update` is the rename signal.

### Decision 3: One op per variable per request

A request is rejected (400) if any variable name appears as `name` or `rename` in more than one op. This makes the projection step trivial (no sequencing surprises) and matches the backoffice UX of "submit form once with the diff."

### Decision 4: Missing `value` initializes/resets to `entry.default`

For both `add` and `update`, omitting `value` is **not** "preserve current"; it explicitly means "use `entry.default`." This:
- Removes the implicit type-compatibility branch ("keep current if still compatible, else default") that would otherwise be subtle.
- Gives admins one clear rule: if you want to keep the current value, send it explicitly.

### Decision 5: Cross-reference detection uses the structured path `content.state.global.<key>`

Terminals already encode references in this structured form. The scan is therefore a single Mongo projection per campaign:

```
db.terminals.find(
  { campaignId },
  { _id: 1, title: 1, "content.state.global": 1 }
)
```

Then in-memory: for each `delete` op, look up `terminal.content?.state?.global?.[name]` existence; for each rename, look up the `from` key existence. No regex over content; no recursive walking.

### Decision 6: Best-effort atomicity, "retry to converge"

A rename touches 1 campaign document + N terminal documents. The deployment target is currently a single-node MongoDB; transactions are unavailable. The chosen sequence is:

1. **Terminals first** — for each rename, issue `db.terminals.updateMany({campaignId, "content.state.global.<from>": {$exists:true}}, {$rename: {"content.state.global.<from>": "content.state.global.<to>"}})`.
2. **Campaign last** — single `$set` rewriting the whole `state` map.

Rationale: if step 1 partially completes and step 2 never runs, terminals point at new keys that don't exist yet in the campaign schema, but the **old** keys still exist on the campaign — references resolve to the old variable (stale but readable). The admin retries the same PATCH; idempotent steps converge.

Alternatives considered:
- **Campaign first**: terminal references would point at a removed `<from>` key with no valid resolution until step 2 completes. Worse failure mode.
- **Mongo transactions**: would require a replica set; non-trivial ops change for marginal benefit on a low-write admin path.

### Decision 7: Validation reuses `validateType`

The existing `validateType(entry, op, value)` helper in `state.service.ts` covers boolean/number/enum/string type checks. The schema-admin path extends it (or wraps it) to also validate:
- `entry.default` against `entry.type` (and against `entry.values` for enum).
- `entry.values` is a non-empty `string[]` when `entry.type === "enum"`, and absent / ignored otherwise.
- `value` (when provided) against `entry.type`, same as `set` semantics.

No new validator class — reuse the helper to keep semantics identical to value mutations.

### Decision 8: Type changes do not trigger any cross-ref scan

References are name-only — terminals don't store the referenced variable's type. Therefore changing a global variable's `type` (e.g., number → string) requires no terminal rewrite. Gameplay logic that downstream consumes `state.global.x` may still break at runtime; that's not a schema-admin concern.

### Decision 9: 404 on update/delete of non-existent variable; 400 on empty ops

Idempotency is tempting for delete-missing (200 no-op), but explicit 404 surfaces the backoffice mistake earlier (likely a stale view). Empty `ops` returns 400 with a clear "no operations" message rather than silently succeeding.

### Decision 10: Where the new methods live

Add `patchCampaignSchema(campaignId, ops)` and `patchTerminalSchema(terminalId, ops)` to `StateService`. The cross-ref scan and terminal `$rename` loop both stay inside `StateService` to keep the state-engine logic in one place. Controllers add the new PATCH routes; admin guard is the only authorization required (same guard pattern as the `reset*` endpoints).

### Decision 11: Documentation surface

- `api/openapi.yaml` is the canonical contract — both new endpoints, request/response schemas (`StateSchemaPatchRequest`, `StateSchemaOp`, `StateSchemaConflictResponse`), and all error responses (400/401/403/404/409).
- `reference/state-schema-admin-sync.md` is written specifically for the backoffice team: endpoint URLs, payload examples, 409 `referencedBy` parsing, recommended UX, retry-on-partial-failure guidance, and the reference convention (`content.state.global.<key>`).
- `reference/campaigns-terminals-api-io.md` gets a short pointer section linking to the new file (not a duplicate of its content).

## Risks / Trade-offs

- **[Partial rename failure leaves stale references]** → Mitigation: apply order (terminals first, campaign last); document retry-to-converge; surface clearly in `reference/state-schema-admin-sync.md`.
- **[Concurrent admin edits clobber each other]** → Mitigation: out of scope for v1; backoffice can serialize at the UI layer (disable form during in-flight PATCH). Future: ETag / `If-Match` on the campaign/terminal document version.
- **[`update` without `value` silently resets a number to 0]** → Mitigation: explicit Decision 4; backoffice form should pre-populate `value` from the current document so admins see what they're overwriting.
- **[Cross-ref scan scales with N(terminals per campaign)]** → Mitigation: project only `content.state.global` and indexed fields; campaign-scoped query already uses the existing `campaignId` index. Negligible at expected campaign sizes (tens to low hundreds of terminals).
- **[Deleting a referenced global is blocked, even when admin "knows what they're doing"]** → Mitigation: documented intentional choice (no force flag); the 409 response gives an actionable list of terminals to fix first.
- **[Rename collision with terminal-side data: terminal already has both `<from>` and `<to>` keys]** → Mitigation: detected during the cross-ref scan; rename is rejected with 409 listing the offending terminals before any write occurs.

## Migration Plan

- **Forward**: additive deployment. No data migration; no existing state field changes shape. After deploy, the new PATCH endpoints become available; nothing else changes.
- **Rollback**: drop the new routes and `StateService` methods. No data left behind (the state Maps are unchanged in shape; any variables admins added through the new endpoint remain present and continue to work with existing mutate/reset endpoints).

## Open Questions

- None blocking implementation. Future considerations (versioning, ETag-based optimistic locking, force-delete override, dry-run preview) are intentionally deferred.
