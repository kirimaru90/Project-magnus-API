## 1. Configuration

- [x] 1.1 Add `terminals.countAdminViews` to `api/src/config/configuration.ts`, sourced from `process.env.TERMINAL_COUNT_ADMIN_VIEWS === 'true'` (default `false`)
- [x] 1.2 Document `TERMINAL_COUNT_ADMIN_VIEWS` (with default `false`) in `.env`

## 2. Schema

- [x] 2.1 Add `@Prop({ type: Number, default: 0 }) viewCount: number` to the `Terminal` schema in `api/src/terminals/schemas/terminal.schema.ts`

## 3. Service

- [x] 3.1 Inject `ConfigService` into `TerminalsService` (`api/src/terminals/terminals.service.ts`)
- [x] 3.2 Add a private helper that decides whether a load should count, given an optional actor: true when actor is not admin; true when actor is admin and `terminals.countAdminViews` is true; otherwise false
- [x] 3.3 Add a private helper to atomically `$inc` `viewCount` by 1 for a terminal id via `terminalModel.updateOne`
- [x] 3.4 Update `load(id, actor?)` to accept the actor and increment `viewCount` when the helper allows it (without changing the returned `{ content, localState, globalState }` payload)
- [x] 3.5 Update `loadByHiddenId(campaignId, hiddenId, actor?)` to accept the actor and increment `viewCount` under the same rule
- [x] 3.6 Include `viewCount` (defaulting to `0`) in the object returned by `toSummary`
- [x] 3.7 Confirm `create`/`update` never persist a client-supplied `viewCount` (the field is not read from the DTO; `content` excludes it)

## 4. Controller

- [x] 4.1 Pass `req.user` into `terminalsService.load(...)` in the `GET /terminals/:id/load` handler (add `@Request()`/actor param)
- [x] 4.2 Pass `req.user` into `terminalsService.loadByHiddenId(...)` in the `GET /campaigns/:id/terminals/by-hidden-id/:hiddenId` handler
- [x] 4.3 Verify `GET /terminals/:id` (detail) does not trigger any increment

## 5. Tests

- [x] 5.1 Add e2e coverage: new terminal reports `viewCount == 0` in the list
- [x] 5.2 Player/anonymous load (by id and by hiddenId) increments `viewCount`
- [x] 5.3 Admin load does not increment when `countAdminViews` is false; increments when true
- [x] 5.4 `GET /terminals/:id` detail does not increment
- [x] 5.5 `GET /campaigns/:id/terminals` returns the up-to-date `viewCount` per terminal

## 6. Verify

- [ ] 6.1 Run `openspec validate "add-terminal-view-count" --strict`
- [ ] 6.2 Run the API test suite and lint; confirm all green
