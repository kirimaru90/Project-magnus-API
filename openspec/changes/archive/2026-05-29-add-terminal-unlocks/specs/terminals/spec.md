## MODIFIED Requirements

### Requirement: Listing terminals in a campaign
The API SHALL expose `GET /campaigns/:id/terminals` returning the terminals belonging to that campaign. The route SHALL apply the same campaign-level access rules as `GET /campaigns/:id`: admin always; player only for assigned or public-active campaigns; anonymous only for public-active campaigns.

Within an accessible campaign, the returned row set SHALL be filtered as follows:

- Admin callers SHALL receive every terminal in the campaign.
- Player and anonymous callers SHALL receive only those terminals where either `content.meta.public === true` OR the terminal's `content.meta.hiddenId` is a member of the caller's `unlockedHiddenIds.<campaignId>` array. Anonymous callers (no user document) are equivalent to a player with an empty unlock list, so they receive only terminals with `content.meta.public === true`.

Each terminal summary returned SHALL include `id`, `campaignId`, `title`, `isPublic` (mirroring `content.meta.public`, defaulting to `false` when absent), `viewCount` (server-owned integer defaulting to `0`), `createdAt`, `updatedAt`, and OPTIONALLY `hiddenId` — present when the row's `content.meta.hiddenId` is a string and omitted otherwise. The summary SHALL NOT include the full `content` field.

The list endpoint SHALL NOT mutate `lastCampaignId` or any other user-document field on the caller's behalf.

#### Scenario: Player lists terminals in an assigned campaign
- **WHEN** a player assigned to campaign C calls `GET /campaigns/C/terminals`
- **THEN** the response is HTTP 200 with an array of terminal summaries
- **AND** each summary includes a numeric `viewCount` field

#### Scenario: Anonymous lists terminals in a private campaign
- **WHEN** an anonymous caller calls `GET /campaigns/C/terminals` for a private campaign C
- **THEN** the response is HTTP 404

#### Scenario: Listed viewCount reflects recorded views
- **GIVEN** terminal T in campaign C has been loaded enough times to record a `viewCount` of 3
- **WHEN** an authorized caller calls `GET /campaigns/C/terminals`
- **THEN** the summary for T reports `viewCount == 3`

#### Scenario: Admin sees all terminals regardless of visibility
- **GIVEN** campaign C contains a public terminal T1 and a private (`meta.public == false`) terminal T2 with `hiddenId == "vault-101"`
- **WHEN** an admin calls `GET /campaigns/C/terminals`
- **THEN** the response array contains summaries for both T1 and T2

#### Scenario: Player without unlock does not see a private terminal
- **GIVEN** campaign C contains a public terminal T1 and a private terminal T2 with `hiddenId == "vault-101"`
- **AND** assigned player U has `unlockedHiddenIds.C == []`
- **WHEN** U calls `GET /campaigns/C/terminals`
- **THEN** the response array contains a summary for T1 but no summary for T2

#### Scenario: Player with matching unlock sees the private terminal
- **GIVEN** campaign C contains private terminal T2 with `hiddenId == "vault-101"`
- **AND** assigned player U has `unlockedHiddenIds.C` containing `"vault-101"`
- **WHEN** U calls `GET /campaigns/C/terminals`
- **THEN** the response array contains a summary for T2

#### Scenario: hiddenId field present on summary when set
- **GIVEN** terminal T has `content.meta.hiddenId == "vault-101"`
- **AND** the caller sees T in the list response (admin, or player with matching unlock)
- **THEN** T's summary contains `hiddenId: "vault-101"`

#### Scenario: hiddenId field omitted on summary when absent
- **GIVEN** terminal T has no `content.meta.hiddenId`
- **WHEN** the caller sees T in the list response
- **THEN** T's summary does not contain a `hiddenId` key (or contains it as `null` — implementations MAY use either, but the field SHALL NOT be a stray non-slug string)

#### Scenario: Anonymous caller in public-active campaign sees only public terminals
- **GIVEN** campaign C is `isPublic == true` and `isActive == true` and contains a public terminal T1 and a private terminal T2
- **WHEN** an anonymous caller calls `GET /campaigns/C/terminals`
- **THEN** the response array contains a summary for T1 but no summary for T2

### Requirement: Hidden terminal lookup by hiddenId

The API SHALL expose `GET /campaigns/:id/terminals/by-hidden-id/:hiddenId` that resolves a `meta.hiddenId` slug to a playable terminal payload. The route SHALL:

- Apply the same access rules as `GET /campaigns/:id/terminals` (admin always; player only for assigned or public-active campaigns; anonymous only for public-active campaigns).
- Return HTTP 404 if no terminal with that `hiddenId` exists in the campaign.
- Return HTTP 404 if the matching terminal has `meta.public === true` (this endpoint is exclusively for hidden terminals; absent `meta.public` is treated as `false`).
- On success, return the same payload as `GET /terminals/:id/load`: `{ content, localState, globalState }` with `content.login.users` always stripped and `content.meta.id` injected as `String(_id)`.

On a successful resolution, the route SHALL apply the following user-state side effects:

- For any authenticated caller (admin or player), SHALL `$set` the caller's `user.lastCampaignId` to the campaign id of the resolved terminal.
- For player callers only, SHALL `$addToSet` the `hiddenId` into `user.unlockedHiddenIds.<campaignId>`. Admin callers SHALL NOT have their `unlockedHiddenIds` modified.
- Anonymous callers (no user document) SHALL NOT trigger any user-document write.

On a 404 response, if the caller is authenticated and the caller's `user.unlockedHiddenIds.<campaignId>` array contains the requested `hiddenId`, the route SHALL `$pull` that `hiddenId` from the array before returning the 404. This self-heal removes residual entries left by missed cascades (e.g., terminal deleted while the user was offline, or a terminal's `hiddenId` changed via update).

#### Scenario: Player resolves a hidden terminal by hiddenId in an assigned campaign
- **WHEN** a player assigned to campaign C calls `GET /campaigns/C/terminals/by-hidden-id/vault-101`
- **AND** campaign C contains a terminal with `meta.hiddenId == "vault-101"` and `meta.public == false`
- **THEN** the response is HTTP 200 with `{ content, localState, globalState }`
- **AND** the response contains no `login.users` entries
- **AND** `content.meta.id` equals the mongo id of the resolved terminal
- **AND** `content.meta.hiddenId == "vault-101"`

#### Scenario: Absent meta.public treated as non-public (lookup succeeds)
- **WHEN** a terminal's content does not declare `meta.public` at all
- **AND** an authorized caller looks it up by `hiddenId`
- **THEN** the response is HTTP 200 (absence of the field is treated as `false`)

#### Scenario: Public terminal not resolvable via this endpoint
- **WHEN** a terminal has `meta.public == true`
- **AND** a caller queries `GET /campaigns/C/terminals/by-hidden-id/<that terminal's hiddenId>`
- **THEN** the response is HTTP 404

#### Scenario: Anonymous caller resolves hidden terminal in a public-active campaign
- **WHEN** campaign C is `isActive == true` and `isPublic == true`
- **AND** it contains a terminal with `meta.hiddenId == "hidden-stash"` and `meta.public == false`
- **AND** an anonymous caller calls `GET /campaigns/C/terminals/by-hidden-id/hidden-stash`
- **THEN** the response is HTTP 200

#### Scenario: Anonymous caller denied for private campaign
- **WHEN** campaign C is private (`isPublic == false`)
- **AND** an anonymous caller calls `GET /campaigns/C/terminals/by-hidden-id/vault-101`
- **THEN** the response is HTTP 404

#### Scenario: Unknown hiddenId
- **WHEN** no terminal in campaign C has `meta.hiddenId == "does-not-exist"`
- **AND** an authorized caller queries `GET /campaigns/C/terminals/by-hidden-id/does-not-exist`
- **THEN** the response is HTTP 404

#### Scenario: Player unlock recorded on successful resolution
- **GIVEN** player U has `unlockedHiddenIds.C == []`
- **AND** campaign C contains a terminal with `meta.hiddenId == "vault-101"` and `meta.public == false`
- **WHEN** U calls `GET /campaigns/C/terminals/by-hidden-id/vault-101`
- **THEN** the response is HTTP 200
- **AND** U's persisted `unlockedHiddenIds.C` now contains `"vault-101"`

#### Scenario: Repeated successful resolution does not duplicate the unlock
- **GIVEN** player U has `unlockedHiddenIds.C == ["vault-101"]`
- **WHEN** U calls `GET /campaigns/C/terminals/by-hidden-id/vault-101` again successfully
- **THEN** U's persisted `unlockedHiddenIds.C` still equals `["vault-101"]` (no duplicate)

#### Scenario: Admin resolution does not record an unlock
- **GIVEN** admin A has `unlockedHiddenIds.C == []`
- **AND** campaign C contains a terminal with `meta.hiddenId == "vault-101"` and `meta.public == false`
- **WHEN** A calls `GET /campaigns/C/terminals/by-hidden-id/vault-101`
- **THEN** the response is HTTP 200
- **AND** A's persisted `unlockedHiddenIds.C` is still `[]`

#### Scenario: lastCampaignId set on successful resolution (player)
- **GIVEN** player U has `lastCampaignId == null`
- **WHEN** U calls `GET /campaigns/C/terminals/by-hidden-id/vault-101` successfully
- **THEN** U's persisted `lastCampaignId` equals `"C"` after the call

#### Scenario: lastCampaignId set on successful resolution (admin)
- **GIVEN** admin A has `lastCampaignId == "C-other"`
- **WHEN** A calls `GET /campaigns/C/terminals/by-hidden-id/vault-101` successfully
- **THEN** A's persisted `lastCampaignId` equals `"C"` after the call

#### Scenario: Anonymous caller writes nothing
- **WHEN** an anonymous caller resolves a hidden terminal in a public-active campaign successfully
- **THEN** no user document is created or modified by the call

#### Scenario: Stale unlock self-heals on 404
- **GIVEN** player U has `unlockedHiddenIds.C == ["vault-101"]`
- **AND** no terminal with `hiddenId == "vault-101"` currently exists in campaign C
- **WHEN** U calls `GET /campaigns/C/terminals/by-hidden-id/vault-101`
- **THEN** the response is HTTP 404
- **AND** U's persisted `unlockedHiddenIds.C` no longer contains `"vault-101"`

#### Scenario: Public-terminal 404 self-heals stale unlock entries
- **GIVEN** player U has `unlockedHiddenIds.C == ["vault-101"]`
- **AND** the terminal with `hiddenId == "vault-101"` in campaign C has been switched to `meta.public == true`
- **WHEN** U calls `GET /campaigns/C/terminals/by-hidden-id/vault-101`
- **THEN** the response is HTTP 404 (this endpoint never serves public terminals)
- **AND** U's persisted `unlockedHiddenIds.C` no longer contains `"vault-101"`

## ADDED Requirements

### Requirement: Non-public terminal access requires unlock

For every terminal route protected by `TerminalAccessGuard` — namely `GET /terminals/:id`, `GET /terminals/:id/load`, `POST /terminals/:id/fictional-login`, `GET /terminals/:id/state`, and `POST /terminals/:id/state/mutate` — the guard SHALL enforce, in addition to existing campaign-level access:

- Admin callers SHALL pass unconditionally (subject to existing campaign access).
- For all other callers (player or anonymous), if the target terminal has `content.meta.public !== true`, the guard SHALL require that the caller's `user.unlockedHiddenIds.<campaignId>` array contain the terminal's `content.meta.hiddenId`. Otherwise the guard SHALL deny with HTTP 404 (consistent with the existing "404 over 403" convention used to avoid leaking existence).
- Anonymous callers (no user document) SHALL NOT pass the privacy check for any non-public terminal.

A non-public terminal whose `content.meta` does not define a `hiddenId` SHALL be accessible only to admin callers via these routes (no path exists for a player to record an unlock for a hidden-id-less terminal).

The privacy check SHALL NOT increment `viewCount`, write `lastCampaignId`, or modify `unlockedHiddenIds`; it is a read-only gate. (Side-effects on success remain governed by their owning route's spec.)

#### Scenario: Admin loads a private terminal directly by id
- **GIVEN** terminal T has `meta.public == false` and `meta.hiddenId == "vault-101"` and belongs to campaign C
- **WHEN** an admin calls `GET /terminals/T/load`
- **THEN** the response is HTTP 200

#### Scenario: Player without unlock denied direct load
- **GIVEN** terminal T has `meta.public == false` and `meta.hiddenId == "vault-101"` and belongs to campaign C
- **AND** assigned player U has `unlockedHiddenIds.C == []`
- **WHEN** U calls `GET /terminals/T/load`
- **THEN** the response is HTTP 404

#### Scenario: Player with unlock allowed direct load
- **GIVEN** terminal T has `meta.public == false` and `meta.hiddenId == "vault-101"` and belongs to campaign C
- **AND** assigned player U has `unlockedHiddenIds.C` containing `"vault-101"`
- **WHEN** U calls `GET /terminals/T/load`
- **THEN** the response is HTTP 200

#### Scenario: Player with unlock allowed direct detail
- **GIVEN** terminal T has `meta.public == false` and `meta.hiddenId == "vault-101"` and belongs to campaign C
- **AND** assigned player U has `unlockedHiddenIds.C` containing `"vault-101"`
- **WHEN** U calls `GET /terminals/T`
- **THEN** the response is HTTP 200

#### Scenario: Player without unlock denied state read
- **GIVEN** terminal T has `meta.public == false` and `meta.hiddenId == "vault-101"`
- **AND** assigned player U has no entry for that hiddenId in `unlockedHiddenIds`
- **WHEN** U calls `GET /terminals/T/state`
- **THEN** the response is HTTP 404

#### Scenario: Player without unlock denied state mutation
- **GIVEN** terminal T has `meta.public == false` and `meta.hiddenId == "vault-101"`
- **AND** assigned player U has no entry for that hiddenId in `unlockedHiddenIds`
- **WHEN** U calls `POST /terminals/T/state/mutate` with a valid mutation body
- **THEN** the response is HTTP 404 and no state mutation is recorded

#### Scenario: Player without unlock denied fictional login
- **GIVEN** terminal T has `meta.public == false` and `meta.hiddenId == "vault-101"`
- **AND** assigned player U has no entry for that hiddenId in `unlockedHiddenIds`
- **WHEN** U calls `POST /terminals/T/fictional-login` with valid fictional credentials
- **THEN** the response is HTTP 404

#### Scenario: Public terminal accessible without unlock
- **GIVEN** terminal T has `meta.public == true`
- **WHEN** any assigned player or anonymous caller (subject to campaign access) calls `GET /terminals/T/load`
- **THEN** the response is HTTP 200 regardless of `unlockedHiddenIds`

#### Scenario: Private hidden-id-less terminal is admin-only
- **GIVEN** terminal T has `meta.public == false` and no `meta.hiddenId`
- **WHEN** any non-admin caller calls `GET /terminals/T/load`
- **THEN** the response is HTTP 404 (no unlock path exists for this terminal)

#### Scenario: Anonymous caller denied private terminal access
- **GIVEN** terminal T has `meta.public == false` and `meta.hiddenId == "vault-101"` in public-active campaign C
- **WHEN** an anonymous caller calls `GET /terminals/T/load`
- **THEN** the response is HTTP 404 (anonymous callers have no unlocks)

### Requirement: Terminal load records last campaign

The route `GET /terminals/:id/load` SHALL, on a successful (HTTP 200) load, `$set` the authenticated caller's `user.lastCampaignId` to the loaded terminal's `campaignId`, for both admin and player callers. Anonymous callers (no user document) SHALL NOT trigger any user-document write. The write SHALL occur regardless of whether `viewCount` is incremented (the two are independently governed).

The write SHALL apply equally to direct loads of public and non-public terminals — any successful load updates the field.

The load response payload contract (`{ content, localState, globalState }`) SHALL NOT change.

#### Scenario: Player load updates lastCampaignId
- **GIVEN** player U has `lastCampaignId == null`
- **AND** terminal T belongs to campaign C
- **WHEN** U calls `GET /terminals/T/load` successfully
- **THEN** U's persisted `lastCampaignId` equals `"C"` after the call

#### Scenario: Admin load updates lastCampaignId
- **GIVEN** admin A has `lastCampaignId == "C-other"`
- **AND** terminal T belongs to campaign C
- **WHEN** A calls `GET /terminals/T/load` successfully
- **THEN** A's persisted `lastCampaignId` equals `"C"` after the call

#### Scenario: Anonymous load writes nothing
- **GIVEN** terminal T is in a public-active campaign and has `meta.public == true`
- **WHEN** an anonymous caller calls `GET /terminals/T/load` successfully
- **THEN** no user document is created or modified by the call

#### Scenario: Load response payload unchanged
- **WHEN** any authorized caller calls `GET /terminals/T/load` successfully
- **THEN** the response body has the exact keys `content`, `localState`, `globalState` (no new keys are added by the lastCampaignId write)
