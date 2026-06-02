## 1. DTOs and validation

- [x] 1.1 Add `api/src/state/dto/schema-patch.dto.ts` with `StateSchemaPatchDto { ops: StateSchemaOpDto[] }`, `StateSchemaOpDto`, and the per-action discriminated shapes (`AddOpDto`, `UpdateOpDto`, `DeleteOpDto`). Use `class-validator` + `class-transformer` + `@nestjs/swagger` decorators consistent with the existing `mutation.dto.ts`.
- [x] 1.2 Add an `EntryShapeDto` with `type ∈ {boolean,number,enum,string}`, `default: unknown`, `values?: string[]`. Validate `values` is present and non-empty iff `type === 'enum'`.
- [x] 1.3 In `state.service.ts`, extract or extend the existing `validateType` helper into a reusable `validateEntryShape(entry)` and `validateValueAgainstType(entry, value)` so the schema-admin code reuses identical type rules to runtime mutations.
- [x] 1.4 Add per-request structural validation: `ops` non-empty (else 400); each variable name appears at most once across `name` and `rename` (else 400).

## 2. StateService — terminal (local) schema PATCH

- [x] 2.1 Add `patchTerminalSchema(terminalId, ops)` to `StateService` returning `{ state: <flat snapshot> }`.
- [x] 2.2 Load the terminal, project the post-ops state map in memory; reject early with 400/404/409 per spec (add-on-existing → 400, update/delete on missing → 404, rename target collision → 409, invalid `entry`/`value` → 400).
- [x] 2.3 Build a single `$set: { state: <newMap> }` document update; persist via `findByIdAndUpdate(..., { new: true })`.
- [x] 2.4 Return the flat snapshot via the existing `stateToFlat` helper.

## 3. StateService — campaign (global) schema PATCH

- [x] 3.1 Add `patchCampaignSchema(campaignId, ops)` to `StateService`.
- [x] 3.2 Project the post-ops state map (same as 2.2) and reject 400/404/409 structural errors before any DB write.
- [x] 3.3 If any op is `delete` or `update` with `rename`, query terminals in the campaign with a projection limited to `{ _id: 1, title: 1, "content.state.global": 1 }`.
- [x] 3.4 For each `delete` op, collect terminals where `content.state.global.<name>` exists. If any → throw a `ConflictException` (HTTP 409) with body `{ error: "Cannot delete referenced variables", conflicts: [{ variable, referencedBy: [{id, title}, ...] }, ...] }`.
- [x] 3.5 For each `rename` op, collect terminals where `content.state.global.<from>` exists AND `content.state.global.<to>` also exists. If any → throw a `ConflictException` with the same `conflicts` shape identifying the offending terminals.
- [x] 3.6 For each rename that passes 3.5, issue `terminalModel.updateMany({campaignId, "content.state.global.<from>": {$exists:true}}, { $rename: { "content.state.global.<from>": "content.state.global.<to>" } })`. Apply renames sequentially before any campaign write.
- [x] 3.7 After all terminal rewrites succeed, apply the campaign-level `$set: { state: <newMap> }` via `findByIdAndUpdate(..., { new: true })`.
- [x] 3.8 Return `{ state: stateToFlat(updated.state) }`.

## 4. Controllers and routes

- [x] 4.1 Add `PATCH /terminals/:id/state/schema` to the terminals controller (or the existing state controller, matching where `mutate`/`reset` already live). Guard: admin-only (same guard pattern as the reset endpoints).
- [x] 4.2 Add `PATCH /campaigns/:id/state/schema` analogously.
- [x] 4.3 Wire `StateSchemaPatchDto` as the body type and add `@ApiOperation` / `@ApiResponse` decorators describing 200, 400, 401, 403, 404, 409.

## 5. Unit tests — StateService

- [x] 5.1 Add `api/src/state/state.service.spec.ts` (or extend the existing one) for `patchTerminalSchema`: add, update with rename, delete, missing-target 404, duplicate-name 400, empty-ops 400, rename-collision 409, invalid-default 400, invalid-value 400, value-omitted-resets-to-default, value-explicit-overrides.
- [x] 5.2 Tests for `patchCampaignSchema` covering all of 5.1 PLUS: delete-rejected-when-referenced (verifies 409 body shape with `conflicts[].referencedBy`), rename-rewrites-referencing-terminals (verifies `$rename` applied), rename-rejected-when-target-collides-on-terminal (409), apply-order-terminals-before-campaign (assert via mock ordering or by checking that a thrown terminal write prevents the campaign write).

## 6. E2E tests

- [x] 6.1 Add `api/test/state-schema-admin.e2e-spec.ts`. Cover the happy paths and key error paths end-to-end (admin token, real Mongo): add/update/delete on terminal; add/update/delete on campaign; cross-ref delete blocked; rename rewrites referencing terminal documents; rename collision on terminal blocked.
- [x] 6.2 Confirm that the existing state e2e tests for `mutate`/`reset` still pass unchanged (regression).

## 7. OpenAPI documentation

- [x] 7.1 In `api/openapi.yaml`, add the `PATCH /terminals/{id}/state/schema` operation with `requestBody` referencing `StateSchemaPatchRequest` and responses for 200, 400, 401, 403, 404.
- [x] 7.2 Add the `PATCH /campaigns/{id}/state/schema` operation with the same request schema and an additional 409 response referencing `StateSchemaConflictResponse`.
- [x] 7.3 Define the schemas: `StateSchemaPatchRequest`, `StateSchemaOp` (discriminated by `action`), `StateEntryShape`, `StateSchemaConflictResponse` (with `conflicts: [{ variable, referencedBy: [{ id, title }] }]`).
- [x] 7.4 Add the `state-schema-admin` tag (or reuse `state` if already present) and assign the new operations to it.

## 8. Reference docs

- [x] 8.1 Create `reference/state-schema-admin-sync.md` for the backoffice integration. Include: endpoint URLs and auth requirements, full request/response payload examples for `add` / `update` (with rename) / `delete`, the 409 `referencedBy` body shape and how to render it as clickable terminal links, the `content.state.global.<key>` reference convention, the apply-order / retry-to-converge story for partial-failure on rename, and a brief recommended UX (block delete with conflict view, require confirm on rename, pre-populate `value` from current state).
- [x] 8.2 In `reference/campaigns-terminals-api-io.md`, add a brief subsection pointing to `state-schema-admin-sync.md` for the schema-admin endpoints. Do not duplicate content.

## 9. Validation

- [x] 9.1 Run `npm run lint` in `api/` and resolve new findings.
- [x] 9.2 Run the full unit and e2e suites and confirm all green.
- [x] 9.3 Run `npx openspec validate add-state-schema-admin --strict` and resolve any spec-format issues.
- [x] 9.4 Manually verify `api/openapi.yaml` is well-formed (e.g., `npx swagger-cli validate api/openapi.yaml` or equivalent project tool).
