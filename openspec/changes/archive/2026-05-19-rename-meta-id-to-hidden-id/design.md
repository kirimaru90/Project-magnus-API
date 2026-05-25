## Context

Today, terminal content embeds a `meta` block with `{ title, id, public }`, where `meta.id` is a human-authored slug (e.g. `"vault-101"`) used for "hidden" terminal lookup via `GET /campaigns/:id/terminals/by-meta/:metaId`. Uniqueness is enforced by a compound index on `(campaignId, content.meta.id)`. The naming is misleading: API consumers naturally expect `id` to refer to the canonical record identifier (the Mongo `_id`, exposed as the top-level `id` in list summaries). This change separates the two concepts: `meta.hiddenId` for the slug, `meta.id` (read-only, injected) for the record identifier.

## Goals / Non-Goals

**Goals:**
- Make `content.meta.id` consistently mean "the canonical id of this terminal" in API responses.
- Introduce `content.meta.hiddenId` as the only writable field for the human-authored slug.
- Keep export JSON portable: `export()` output must be importable without modification.
- Provide a deterministic migration path for existing data and the unique index.

**Non-Goals:**
- No change to the underlying storage of the terminal `_id` itself, nor to the top-level `id` returned in list summaries.
- No change to access control, state projection, fictional-user handling, or any other terminal behavior.
- No backward-compatibility shim accepting both `meta.id` and `meta.hiddenId` on input — the input field is renamed, not aliased.

## Decisions

### 1. Reject `meta.id` on input rather than aliasing
Clients submitting `content.meta.id` get HTTP 400. Rationale: the new contract is that `meta.id` is server-owned and equals the mongo id on read; silently accepting it on input would let clients believe they could control it. Validation rejection makes the breaking nature explicit and prevents data drift. Alternative considered: accept `meta.id` and treat it as `meta.hiddenId`. Rejected because it leaves two ways to express the same field and obscures the new semantics.

### 2. Inject `meta.id` at read time, do not persist it
Storage holds only `content.meta.hiddenId`. On every read path (`detail`, `load`, `loadByHiddenId`) the service spreads `{ ...content.meta, id: String(doc._id) }` into the response. Rationale: keeps the source of truth single (the mongo `_id`); removes the risk of the persisted `meta.id` drifting from the actual `_id`; makes export trivially clean (no stored field to strip). Alternative considered: persist a denormalized copy of `_id` into `content.meta.id`. Rejected as duplication with no upside.

### 3. Strip the injected `meta.id` in `export()`
`export()` must round-trip through `import` (which rejects `meta.id`). The service performs the read-time injection unconditionally, then `export()` deletes `content.meta.id` from its return value, leaving `content.meta = { title, hiddenId, public? }`. Alternative considered: have `export()` call a different code path that skips injection. Rejected because the read-projection lives in one helper; one explicit delete in `export()` is simpler than branching the projection.

### 4. Route renamed to `by-hidden-id`, no alias
The route path, the URL param name, and the controller handler all rename to `hidden-id` / `hiddenId` / `loadByHiddenId`. Rationale: matches the field rename, no transitional surface to support. Alternative considered: keep `by-meta` as an alias forwarding to the new handler. Rejected — no internal consumer guarantees, and the swagger surface stays cleaner with a single path.

### 5. `hiddenId` is optional; uniqueness is enforced via a partial index
Not every terminal needs a human-authored slug — only terminals intended to be looked up by the `by-hidden-id` route do. Making `hiddenId` required would force every fixture, import, and admin-created terminal to invent a slug it will never use. So `hiddenId` is `@IsOptional()` in the DTO, and the compound unique index becomes a **partial** index with `partialFilterExpression: { 'content.meta.hiddenId': { $type: 'string' } }`. This means:
- Multiple terminals without `hiddenId` may coexist within the same campaign (the partial filter excludes them from the unique constraint).
- Per-campaign uniqueness still holds whenever `hiddenId` is set.
- The migration script must build the new index with `partialFilterExpression`, not a plain `unique: true`, otherwise a campaign with two `hiddenId`-less terminals would collide on the `null` key.

Alternative considered: keep `hiddenId` required and have callers synthesize a placeholder for non-hidden terminals. Rejected — it pushes a meaningless value into stored data and the export payload, and the synthesized values would themselves need to be unique.

### 6. Migration is a one-shot script, not auto-on-boot
`api/scripts/migrate-hidden-id.ts` performs `$rename` and drops the old index. The new index is created by the standard Mongoose index sync on app boot (or built explicitly inside the script at the end). Rationale: index transitions and field renames are deployment-time operations, not request-path operations. An ops-controlled script makes the rollout auditable. The script must run BEFORE the app boots with the new code, otherwise:
- old `meta.id` writes would collide with the new unique index, and
- reads would surface `hiddenId: undefined` for unmigrated docs.

## Risks / Trade-offs

- **[Risk] Clients still posting `content.meta.id` will start receiving HTTP 400.** → Mitigation: call this out in the changelog/release notes and the updated `reference/api_spec.md`. The 400 is loud, not silent.
- **[Risk] Deploying app before running the migration breaks writes (duplicate-key on `hiddenId: null`) and corrupts reads.** → Mitigation: tasks.md gates the deploy on running the migration script first; the script is idempotent (`$rename` is a no-op on already-renamed docs; index drop is wrapped in try/ignore-if-missing).
- **[Risk] Existing data with `content.meta.id == null` would all collide on a unique `hiddenId` index.** → Mitigation: the new index is partial (`partialFilterExpression: { 'content.meta.hiddenId': { $type: 'string' } }`), so docs without a `hiddenId` string are simply not indexed; the migration's `$rename` is a no-op on those docs. Verify with a count before/after in the migration script.
- **[Trade-off] No alias means clients must update in lockstep.** Acceptable: this API has no external third-party consumers; the front-end ships from the same repo and is updated together.

## Migration Plan

1. Merge the API change behind a deployable artifact.
2. In the target environment, run `npx ts-node api/scripts/migrate-hidden-id.ts` (or equivalent) against the live database. The script:
   a. Renames `content.meta.id` → `content.meta.hiddenId` on every document in `terminals` via `updateMany({}, { $rename: { 'content.meta.id': 'content.meta.hiddenId' } })`.
   b. Drops index `campaignId_1_content.meta.id_1` (catch & ignore "index not found").
   c. Builds the new index `{ campaignId: 1, 'content.meta.hiddenId': 1 }` with `unique: true` and `partialFilterExpression: { 'content.meta.hiddenId': { $type: 'string' } }` (Mongoose will otherwise create a non-partial version on app boot — the partial filter must be set explicitly, both here and on the schema definition).
3. Deploy the new app image.
4. **Rollback**: revert deployment, then run a reverse migration: `$rename` `hiddenId` → `id`, drop the new index, recreate the old one. Same script structure, opposite direction.

## Open Questions

None.
