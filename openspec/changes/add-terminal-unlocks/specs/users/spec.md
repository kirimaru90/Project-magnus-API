## ADDED Requirements

### Requirement: User document carries last-campaign and unlock state

Each user document SHALL carry two server-owned fields that record per-user terminal navigation state:

- `lastCampaignId`: a nullable string id of the campaign the user most recently entered a terminal in. Default `null`. Never accepted from client input on any user-management endpoint.
- `unlockedHiddenIds`: a map keyed by campaign id whose values are arrays of `hiddenId` slugs the user has unlocked via the by-hidden-id terminal route. Default `{}`. Never accepted from client input on any user-management endpoint.

Existing user documents that pre-date this requirement SHALL be treated as having `lastCampaignId == null` and `unlockedHiddenIds == {}` on read; no migration is required.

User-management endpoints (`GET /users`, `POST /users`, `GET /users/:id`, `PUT /users/:id`, `DELETE /users/:id`) SHALL NOT expose either field in their response bodies and SHALL NOT accept either field on input. The fields are written exclusively by the auth and terminals modules per their own specifications.

#### Scenario: New user defaults
- **WHEN** an admin creates a new user via `POST /users`
- **THEN** the persisted user document has `lastCampaignId == null` and `unlockedHiddenIds == {}`

#### Scenario: User-list response shape unchanged
- **WHEN** an admin calls `GET /users`
- **THEN** the response items contain `id`, `username`, `role`, `createdAt` and do not contain `lastCampaignId` or `unlockedHiddenIds`

#### Scenario: User-update ignores new fields on input
- **WHEN** an admin calls `PUT /users/:id` with a body that includes `lastCampaignId` or `unlockedHiddenIds`
- **THEN** the response is HTTP 200 and the persisted user document's values for those fields are unchanged

### Requirement: Cascade on campaign deletion

When a campaign is deleted, the system SHALL cascade the deletion across every user document:

- For every user whose `lastCampaignId` equals the deleted campaign's id, the field SHALL be set to `null`.
- For every user, the per-campaign entry at `unlockedHiddenIds.<campaignId>` SHALL be removed (`$unset`).

The cascade SHALL run as part of the campaign-delete operation and SHALL complete before the delete response is returned.

#### Scenario: lastCampaignId cleared on referenced campaign delete
- **GIVEN** user U has `lastCampaignId == "C1"`
- **WHEN** an admin deletes campaign `C1`
- **THEN** user U's `lastCampaignId` is `null` after the delete completes

#### Scenario: Per-campaign unlock entry removed on campaign delete
- **GIVEN** user U has `unlockedHiddenIds == { "C1": ["vault-101"], "C2": ["root"] }`
- **WHEN** an admin deletes campaign `C1`
- **THEN** user U's `unlockedHiddenIds` is `{ "C2": ["root"] }` (the `C1` key is gone)

#### Scenario: Unrelated users unaffected
- **GIVEN** user V has `lastCampaignId == "C2"` and `unlockedHiddenIds == { "C2": ["s1"] }`
- **WHEN** an admin deletes campaign `C1`
- **THEN** user V's `lastCampaignId` is still `"C2"` and `unlockedHiddenIds` is still `{ "C2": ["s1"] }`

### Requirement: Cascade on terminal deletion

When a terminal that carries a `content.meta.hiddenId` is deleted, the system SHALL cascade the deletion across every user document by `$pull`ing that `hiddenId` from `unlockedHiddenIds.<campaignId>`, where `campaignId` is the deleted terminal's parent campaign.

If the deleted terminal did not have a `hiddenId`, no user-document update is required.

The cascade SHALL run as part of the terminal-delete operation and SHALL complete before the delete response is returned.

#### Scenario: hiddenId removed from all unlock lists on terminal delete
- **GIVEN** terminal T in campaign C has `content.meta.hiddenId == "vault-101"`
- **AND** users U1 and U2 each have `"vault-101"` in `unlockedHiddenIds.C`
- **WHEN** an admin deletes terminal T
- **THEN** U1's and U2's `unlockedHiddenIds.C` no longer contains `"vault-101"`

#### Scenario: Terminal without hiddenId triggers no cascade
- **WHEN** an admin deletes a terminal whose `content.meta` has no `hiddenId`
- **THEN** no user document's `unlockedHiddenIds` is modified by the delete

#### Scenario: Other unlocks unaffected
- **GIVEN** user U has `unlockedHiddenIds.C == ["vault-101", "back-door"]`
- **WHEN** an admin deletes the terminal with `hiddenId == "vault-101"` in campaign C
- **THEN** user U's `unlockedHiddenIds.C` equals `["back-door"]`
