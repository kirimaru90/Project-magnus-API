## Why

Today, campaign (global) and terminal (local) state variables are immutable in shape once a campaign or terminal exists: the API only mutates `value` on already-declared variables. Backoffice admins need to evolve those schemas over time — adding new variables, retiring obsolete ones, restructuring types, and renaming — without manual DB surgery and without breaking terminals that reference global variables in `content.state.global.<key>`.

## What Changes

- Add `PATCH /campaigns/:id/state/schema` (admin) to add / update / delete entries of `campaigns.state` in one atomic request.
- Add `PATCH /terminals/:id/state/schema` (admin) to do the same for `terminals.state`.
- Define a single op shape with three actions: `add`, `update`, `delete`. **Rename is folded into `update`** via an optional `rename` field.
- Per-request invariant: each variable name may appear in at most one op (counting both `name` and `rename`). Duplicates → 400.
- Missing `value` on `add` / `update` initializes / resets the variable to `entry.default`.
- Renaming to a target that already exists (in current schema OR projected by another op) → 409.
- **Cross-reference protection (campaign scope only):** deleting a global variable that any terminal references at `content.state.global.<name>` → 409 with `{ variable, referencedBy: [{ id, title }, …] }`. Renaming a referenced global rewrites all referencing terminals via Mongo `$rename`. If any terminal already has both old and new keys present, the rename is rejected → 409.
- **Apply order on campaign endpoint:** terminal rewrites first, campaign `$set` last. Best-effort atomicity (no Mongo transactions); on partial failure, references are stale-but-readable and retry converges.
- Terminal (local) endpoint has no cross-ref scan and no terminal-rewrite step (campaigns never reference local vars; terminals never reference each other).
- Existing `mutate*` / `reset*` endpoints are **unchanged**.
- Empty `ops` → 400. `update` / `delete` targeting a non-existent variable → 404.
- Update `api/openapi.yaml` with both new endpoints, request/response schemas, and the 400/404/409 error responses (including the structured 409 conflict body).
- Add `reference/state-schema-admin-sync.md` for the backoffice team: endpoint contracts, op payload shape, 409 `referencedBy` interpretation, recommended UX (block delete, surface offending terminals as clickable links), atomicity caveat and retry guidance, and the `content.state.global.<key>` reference convention.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `state-engine`: adds schema-level admin operations (`add` / `update` / `delete` with rename) on top of the existing value-mutation and reset model, plus the cross-reference protection for globals.

## Impact

- **API surface (additive):** two new admin-only PATCH endpoints. No existing endpoint shape changes.
- **Mongoose models:** no schema changes — `state` is already a free-form `Map<string, StateEntry>` on both `Campaign` and `Terminal`.
- **Service layer:** `StateService` gains `patchCampaignSchema` and `patchTerminalSchema` methods. The existing `validateType` helper is reused for per-entry validation of `default` and (when provided) `value`.
- **Controllers:** new routes under admin guard on `CampaignsController` / `TerminalsController` (or a state-dedicated controller — TBD in design).
- **Reference docs:** `reference/campaigns-terminals-api-io.md` updated to mention the schema-admin endpoints; new `reference/state-schema-admin-sync.md` written specifically for the backoffice integration.
- **OpenAPI:** `api/openapi.yaml` gains two PATCH operations and their schemas (`StateSchemaPatchRequest`, `StateSchemaPatchOp`, `StateSchemaReferenceConflict`).
- **Operational:** no transactions required; documented retry-to-converge story for partial failures on rename.
