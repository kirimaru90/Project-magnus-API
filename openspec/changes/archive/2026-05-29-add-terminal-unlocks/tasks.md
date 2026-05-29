## 1. User schema and helpers

- [x] 1.1 Add `lastCampaignId: string | null` (default `null`) to `User` Mongoose schema in `api/src/users/schemas/user.schema.ts`.
- [x] 1.2 Add `unlockedHiddenIds: Map<string, string[]>` (default `{}`) to the same schema using `@Prop({ type: Map, of: [String], default: {} })`.
- [x] 1.3 Confirm `UsersService` create/update flows do not accept either new field from request bodies (strip if present, or rely on DTO whitelisting). Add a brief targeted test if a gap exists.
- [x] 1.4 Confirm `GET /users` list/detail/update responses do not surface the new fields (no leakage into existing user-management endpoints).

## 2. Cascade hooks

- [x] 2.1 In `CampaignsService.delete` (or equivalent campaign-delete path), after the campaign is removed, run `userModel.updateMany({ lastCampaignId: campaignId }, { $set: { lastCampaignId: null } })` and `userModel.updateMany({}, { $unset: { [\`unlockedHiddenIds.${campaignId}\`]: '' } })`.
- [x] 2.2 In `TerminalsService.delete`, after the terminal is removed (and after the existing fictional-users cleanup), if the deleted terminal had a `content.meta.hiddenId`, run `userModel.updateMany({}, { $pull: { [\`unlockedHiddenIds.${campaignId}\`]: hiddenId } })`.
- [x] 2.3 Add unit tests covering: lastCampaignId clearing on campaign delete, unlockedHiddenIds entry removal on campaign delete, hiddenId pull on terminal delete, no-op when deleted terminal has no hiddenId.

## 3. /auth/me self-heal and shape

- [x] 3.1 Extend `AuthService.me` to also select `lastCampaignId` and `unlockedHiddenIds` from the user document.
- [x] 3.2 If `lastCampaignId` is non-null, look up the campaign by id; if missing, `$set` the user's `lastCampaignId` to `null` and use `null` in the response.
- [x] 3.3 Serialize `unlockedHiddenIds` (Mongoose Map) to a plain object `{ [campaignId]: string[] }` for the response. Empty case is `{}`.
- [x] 3.4 Add tests covering: response shape with both fields, stale lastCampaignId being lazily nulled and persisted, valid lastCampaignId returned as-is, unlock map serialization for empty and populated cases.

## 4. TerminalAccessGuard privacy check

- [x] 4.1 In `api/src/common/guards/terminal-access.guard.ts`, after the existing campaign-access verification, fetch the candidate terminal's `content.meta.public` and `content.meta.hiddenId` (likely already loaded by the guard — re-use the existing query).
- [x] 4.2 Short-circuit: admin role passes immediately. Public terminal (`meta.public === true`) passes immediately for any caller.
- [x] 4.3 For non-admin callers against non-public terminals: load the user document (only when needed) and require `user.unlockedHiddenIds.<campaignId>` to contain the terminal's `hiddenId`. Anonymous callers fail this check unconditionally. On failure, throw `NotFoundException` (HTTP 404).
- [x] 4.4 Confirm the guard rejection path returns 404 (not 403) — matches the existing convention.
- [x] 4.5 Update guard unit tests in `api/src/common/guards/guards.spec.ts`: admin/public bypass, player-with-unlock pass, player-without-unlock deny, anonymous-on-private deny, hidden-id-less private terminal denied to non-admins.

## 5. List filter + hiddenId field

- [x] 5.1 In `TerminalsService.listByCampaign(campaignId, actor)`, change the signature to accept the optional `actor: AuthenticatedUser`. Pass `req.user` from the controller (`terminals.controller.ts`, the `listByCampaign` handler).
- [x] 5.2 For admin actors, return all rows (unchanged behavior).
- [x] 5.3 For non-admin actors, fetch the user's `unlockedHiddenIds.<campaignId>` once (empty array for anonymous), then filter the campaign's terminals by `meta.public === true || unlockedSet.has(meta.hiddenId)`.
- [x] 5.4 In `toSummary`, add `hiddenId` to the returned object when `content.meta.hiddenId` is a string; omit otherwise.
- [x] 5.5 Add tests for: admin sees all, player with empty unlocks sees only public, player with matching unlock sees the unlocked private terminal, anonymous sees only public, hiddenId field present on summary when set, omitted when absent.

## 6. Load endpoint writes lastCampaignId

- [x] 6.1 In `TerminalsService.load`, after a successful load (after the optional view-count increment), if `actor` is authenticated, `$set` `user.lastCampaignId = String(terminal.campaignId)`. Skip for anonymous.
- [x] 6.2 Add tests for: admin load updates lastCampaignId, player load updates lastCampaignId, anonymous load updates nothing, load response payload contract unchanged (`{ content, localState, globalState }`).

## 7. loadByHiddenId — writes and self-heal

- [x] 7.1 In `TerminalsService.loadByHiddenId`, on the success path, if `actor` is authenticated, `$set` `user.lastCampaignId = campaignId`. Skip for anonymous.
- [x] 7.2 On the success path, if `actor.role === 'player'`, `$addToSet` the `hiddenId` into `user.unlockedHiddenIds.<campaignId>`. Admins are skipped.
- [x] 7.3 On the 404 path (terminal not found OR matched terminal is `meta.public === true`), if `actor` is authenticated and the user's `unlockedHiddenIds.<campaignId>` contains the requested `hiddenId`, `$pull` it before throwing `NotFoundException`.
- [x] 7.4 Add tests for: player unlock recorded on success, no duplicate on repeated success, admin success leaves unlocks untouched, anonymous success writes nothing, lastCampaignId set on player and admin success, stale-unlock self-heal removes entry on 404 (both "terminal missing" and "terminal switched public" branches), no self-heal for anonymous (no user doc).

## 8. e2e + reference docs

- [x] 8.1 Add an e2e flow exercising the full lifecycle: player resolves a hidden terminal → sees it in subsequent list calls → loads it directly by id → admin deletes it → it disappears from list and unlock entry is gone.
- [x] 8.2 Add an e2e flow for /auth/me self-heal: player has lastCampaignId set, admin deletes the campaign, player calls /auth/me, response shows `lastCampaignId: null` and persisted value is now null.
- [x] 8.3 Update `reference/campaigns-terminals-api-io.md` with: the list filter rules, the `hiddenId` field on summaries, the privacy gate on TerminalAccessGuard routes, the new side-effects on load and loadByHiddenId.
- [x] 8.4 Add a brief section to whichever auth reference doc covers `/auth/me` documenting the new `lastCampaignId` and `unlockedHiddenIds` fields and the lazy self-heal.

## 9. Validation

- [x] 9.1 Run `npm run lint` and fix any new findings introduced by the changes.
- [x] 9.2 Run the full test suite (`npm test` and e2e if separate) and confirm all green.
- [x] 9.3 Run `npx openspec validate add-terminal-unlocks --strict` and resolve any spec-format issues.
