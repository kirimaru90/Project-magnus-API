## Why

The terminal content field `meta.id` is currently a human-authored slug used to look up "hidden" (non-public) terminals. The name `id` collides with the natural meaning of an identifier (the terminal's MongoDB `_id`), which is confusing for API consumers and prevents responses from carrying the real identifier inside `content.meta` alongside other metadata. We want `meta.id` to mean "the canonical id of this terminal" and a new field `meta.hiddenId` to carry the human-authored slug.

## What Changes

- **BREAKING**: Rename input field `content.meta.id` → `content.meta.hiddenId` on `POST /campaigns/:id/terminals`, `PUT /terminals/:id`, and `POST /campaigns/:id/terminals/import`. `content.meta.hiddenId` is now **optional** (terminals without a slug are valid). Submitting `content.meta.id` on input is rejected with HTTP 400 (clients may not override the server-assigned mongo id).
- **BREAKING**: Rename lookup route `GET /campaigns/:id/terminals/by-meta/:metaId` → `GET /campaigns/:id/terminals/by-hidden-id/:hiddenId`. The path param name and the underlying Mongo query field both move from `meta.id` to `meta.hiddenId`.
- The terminal's `content.meta.id` field is **not persisted** in the document. On every read path (`GET /terminals/:id`, `GET /terminals/:id/load`, and the by-hidden-id lookup), the service injects `content.meta.id = String(_id)` into the returned `content.meta` — the same identifier returned as the top-level `id` in list summaries — and returns `content.meta.hiddenId` as stored (or absent, if unset).
- **BREAKING**: Export (`POST /terminals/:id/export`) returns `content.meta` with `{ title, public?, hiddenId? }` — the injected `meta.id` is stripped so the JSON is round-trippable through import.
- Replace the unique compound index `{ campaignId: 1, 'content.meta.id': 1 }` with a **partial** unique compound index `{ campaignId: 1, 'content.meta.hiddenId': 1 }` whose `partialFilterExpression` matches only documents where `content.meta.hiddenId` is a string. Per-campaign uniqueness applies only when `hiddenId` is defined; multiple terminals without `hiddenId` may coexist in the same campaign.
- Add a one-shot migration script (`api/scripts/migrate-hidden-id.ts`) that `$rename`s `content.meta.id` → `content.meta.hiddenId` across existing terminal documents, drops the old index, and creates the new partial unique index.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `terminals`: rename of the human-authored slug field (`meta.id` → `meta.hiddenId`), repurposing of `meta.id` as the server-injected mongo id on read, export-strip rule, renamed lookup endpoint, and corresponding uniqueness-index change.

## Impact

- API consumers that POST/PUT/import terminals must send `content.meta.hiddenId` instead of `content.meta.id`. Sending `content.meta.id` is now a validation error.
- API consumers that GET `/campaigns/:id/terminals/by-meta/:metaId` must switch to `/campaigns/:id/terminals/by-hidden-id/:hiddenId`.
- Code paths in scope:
  - `api/src/terminals/dto/terminal-content.dto.ts` (`MetaDto`)
  - `api/src/terminals/schemas/terminal.schema.ts` (compound index)
  - `api/src/terminals/terminals.service.ts` (query field, response `meta.id` injection, export stripping, `loadByMetaId` → `loadByHiddenId`)
  - `api/src/terminals/terminals.controller.ts` (route, swagger summary, handler name)
- Tests: `api/test/terminals.e2e-spec.ts` fixtures and assertions for duplicate-hidden-id, by-hidden-id lookup, import, and any direct inspection of `content.meta.id`.
- Documentation: `reference/api_spec.md` wherever it documents the meta block or the by-meta route.
- Existing data: requires running the migration script before/at deploy to rename `content.meta.id` and drop the old index; otherwise new writes will fail the new unique index and reads will surface `hiddenId: undefined`.
