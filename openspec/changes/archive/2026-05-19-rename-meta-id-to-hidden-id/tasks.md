## 1. DTO rename and input rejection

- [x] 1.1 In `api/src/terminals/dto/terminal-content.dto.ts`, rename `MetaDto.id` to `MetaDto.hiddenId` (keep `@IsString()` and `@ApiProperty()`).
- [x] 1.2 Add a `MetaDto` validator that rejects `id` on input: e.g. use class-validator's `@Allow` style negation (`@IsEmpty()` on a declared `id?: never`) or `forbidNonWhitelisted` + `whitelist: true` on the global `ValidationPipe` plus a guard field, so submitting `content.meta.id` produces HTTP 400.
- [x] 1.3 Update Swagger `ApiProperty` description on `hiddenId` to "Human-authored slug for hidden-terminal lookup".

## 2. Schema and index rename

- [x] 2.1 In `api/src/terminals/schemas/terminal.schema.ts`, replace the compound unique index `{ campaignId: 1, 'content.meta.id': 1 }` with `{ campaignId: 1, 'content.meta.hiddenId': 1 }` (keep `unique: true`).

## 3. Service: query field, response injection, export strip, method rename

- [x] 3.1 In `api/src/terminals/terminals.service.ts`, rename `loadByMetaId` to `loadByHiddenId`. Update the Mongo query field from `'content.meta.id'` to `'content.meta.hiddenId'`. Update the param name accordingly.
- [x] 3.2 Introduce a single read-projection helper (e.g. `withInjectedMetaId(doc)`) that returns the doc's `content` with `content.meta = { ...content.meta, id: String(doc._id) }`. Apply it in: `detail` (`GET /terminals/:id`), `load` (`GET /terminals/:id/load`), and `loadByHiddenId`.
- [x] 3.3 In `export()`, after assembling the export payload via the standard read projection, delete `payload.content.meta.id` so the exported `meta` contains only `{ title, hiddenId, public? }`.
- [x] 3.4 Audit any other internal callers of the old `loadByMetaId` and update them.

## 4. Controller: route, param, swagger, handler rename

- [x] 4.1 In `api/src/terminals/terminals.controller.ts`, change the route from `GET /campaigns/:id/terminals/by-meta/:metaId` to `GET /campaigns/:id/terminals/by-hidden-id/:hiddenId`. Rename the handler method (`getByMetaId` → `getByHiddenId`) and the `@Param('metaId')` to `@Param('hiddenId')`.
- [x] 4.2 Update the `@ApiOperation({ summary: ... })` decorator on the route to reference `hiddenId` instead of `meta.id`.
- [x] 4.3 Confirm the controller passes `hiddenId` into `service.loadByHiddenId(campaignId, hiddenId)`.

## 5. Migration script

- [x] 5.1 Create `api/scripts/migrate-hidden-id.ts`. Connect to Mongo using the same env (`MONGO_URL`/`MONGODB_URI`) the app uses. Log counts before/after.
- [x] 5.2 Run `db.collection('terminals').updateMany({}, { $rename: { 'content.meta.id': 'content.meta.hiddenId' } })`. Report `matchedCount` / `modifiedCount`.
- [x] 5.3 Drop the old index `campaignId_1_content.meta.id_1` (`try { dropIndex } catch (e) { if (e.codeName !== 'IndexNotFound') throw e }`).
- [x] 5.4 Optionally call `Terminal.syncIndexes()` (or `createIndex` directly) to build the new `(campaignId, content.meta.hiddenId)` unique index so the first app boot is not stuck waiting on index build.
- [x] 5.5 Add a section to `tasks.md` follow-up notes (or a README under `api/scripts/`) describing how to run: `npx ts-node api/scripts/migrate-hidden-id.ts` (or `pnpm ts-node ...` depending on the package manager).

## 6. Tests

- [x] 6.1 Update `api/test/terminals.e2e-spec.ts` fixtures: every POST/PUT/import body now uses `content.meta.hiddenId` instead of `content.meta.id`.
- [x] 6.2 Update the duplicate-id section to assert HTTP 409 when posting/importing a duplicate `hiddenId` within the same campaign, and HTTP 201 across campaigns.
- [x] 6.3 Update the by-meta lookup section: change all URLs to `/by-hidden-id/`, change param names. Cover: assigned-player success, anonymous on public-active campaign, public-terminal lookup returns 404, unknown-hiddenId returns 404, absent `meta.public` treated as non-public.
- [x] 6.4 Add a test asserting that POSTing a body containing `content.meta.id` returns HTTP 400.
- [x] 6.5 Add a test asserting `GET /terminals/:id` and `GET /terminals/:id/load` both return `content.meta.id` equal to the top-level `id` (the mongo `_id`) AND `content.meta.hiddenId` equal to the slug as stored.
- [x] 6.6 Add a test asserting that `POST /terminals/:id/export` returns `content.meta` with `{ title, hiddenId, public? }` and NO `id` key, and that the exported JSON can be re-imported into another campaign.
- [x] 6.7 Update any other assertions in the e2e file that inspected `content.meta.id` directly to inspect `content.meta.hiddenId` (or the injected `meta.id` if that was the intent).

## 7. Documentation

- [x] 7.1 Update `reference/api_spec.md` everywhere it describes the `meta` block: replace the writable `meta.id` with `meta.hiddenId`; document that `meta.id` is a read-only injected mirror of the top-level `id`.
- [x] 7.2 Update `reference/api_spec.md` route table: replace `GET /campaigns/:id/terminals/by-meta/:metaId` with `GET /campaigns/:id/terminals/by-hidden-id/:hiddenId`. Update any example payloads.
- [x] 7.3 Note the export contract: `content.meta` on exported JSON contains only `{ title, hiddenId, public? }`.

## 8. Verification

- [x] 8.1 Run the API e2e test suite locally; all tests pass.
- [ ] 8.2 Run the migration script against a scratch database seeded with the old shape; verify documents are renamed and the old index is dropped.
- [ ] 8.3 Boot the API against the migrated database; verify the new unique index `(campaignId, content.meta.hiddenId)` exists.
- [ ] 8.4 Smoke-test the renamed endpoint with `curl`/Postman against a running instance.

## 9. Optional hiddenId and partial unique index (follow-up revision)

- [x] 9.1 In `api/src/terminals/dto/terminal-content.dto.ts`, mark `MetaDto.hiddenId` as `@IsOptional()` (and `@ApiPropertyOptional`) so terminals without a slug pass validation.
- [x] 9.2 In `api/src/terminals/schemas/terminal.schema.ts`, change the compound unique index to a partial index: `{ unique: true, partialFilterExpression: { 'content.meta.hiddenId': { $type: 'string' } } }`. Documents without `hiddenId` SHALL not be indexed.
- [x] 9.3 In `api/scripts/migrate-hidden-id.ts`, change the `createIndex` call to pass the same `partialFilterExpression`. Update the script's logged messages to reflect the partial nature of the index.
- [x] 9.4 Confirm `terminals.service.ts` does not require `hiddenId` to be present anywhere (creation, update, read, export, by-hidden-id lookup). The injected `meta.id` is independent of `hiddenId`; the by-hidden-id lookup naturally fails with HTTP 404 when no terminal in the campaign has the queried slug, including the case where every terminal lacks `hiddenId`.
- [x] 9.5 Update `api/test/terminals.e2e-spec.ts`: add a test asserting that two terminals can be created in the same campaign with no `hiddenId` on either (both 201). Add a test asserting that a terminal created without `hiddenId` still returns the injected `content.meta.id == _id` on detail and load, with `content.meta.hiddenId` absent.
- [x] 9.6 Audit existing e2e fixtures: any test creating a single one-off terminal that doesn't need a slug can drop `hiddenId` from its payload — but keep slugs in all duplicate-id and by-hidden-id tests.
- [x] 9.7 Update `reference/api_spec.md` to note `meta.hiddenId` is optional and that the uniqueness constraint applies only when present.
