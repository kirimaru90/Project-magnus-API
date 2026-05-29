# users Specification

## Purpose

Admin CRUD over real users (`admin` and `player` roles), including password reset.

## Requirements

### Requirement: Admin can list real users
The API SHALL expose `GET /users` returning all real users. The route SHALL be restricted to admin role. Response items SHALL include `id`, `username`, `role`, and `createdAt`, and SHALL NOT include any password material.

#### Scenario: Admin lists users
- **WHEN** an admin calls `GET /users`
- **THEN** the response is HTTP 200 with an array of user summaries containing `id`, `username`, `role`, `createdAt`

#### Scenario: Player cannot list users
- **WHEN** a player-role token is used to call `GET /users`
- **THEN** the response is HTTP 403

#### Scenario: Anonymous cannot list users
- **WHEN** `GET /users` is called without a token
- **THEN** the response is HTTP 401

### Requirement: Admin can create users
The API SHALL expose `POST /users` accepting `{ username, password, role }` where `role` is `admin` or `player`. On success the response SHALL be HTTP 201 with the created user summary (no password fields). Usernames SHALL be unique; a duplicate request SHALL return HTTP 409.

#### Scenario: Admin creates a player
- **WHEN** an admin calls `POST /users` with body `{ username: "alice", password: "p@ssword1", role: "player" }`
- **THEN** the response is HTTP 201 with `{ id, username: "alice", role: "player", createdAt }`
- **AND** the persisted record stores `passwordHash` as a bcrypt hash

#### Scenario: Duplicate username
- **WHEN** an admin tries to create a user whose `username` already exists
- **THEN** the response is HTTP 409

#### Scenario: Invalid role
- **WHEN** an admin sends `POST /users` with `role: "superadmin"`
- **THEN** the response is HTTP 400

### Requirement: Admin can read, update, and delete users
The API SHALL expose `GET /users/:id`, `PUT /users/:id`, and `DELETE /users/:id`, all admin-only. `PUT` SHALL accept any subset of `{ username, password, role }`. When `password` is included, it SHALL be re-hashed via bcrypt before storage.

#### Scenario: Admin reads a user
- **WHEN** an admin calls `GET /users/:id` for an existing user
- **THEN** the response is HTTP 200 with `{ id, username, role, createdAt }`

#### Scenario: Admin updates a user's role
- **WHEN** an admin calls `PUT /users/:id` with body `{ role: "admin" }`
- **THEN** the response is HTTP 200 and subsequent `GET /users/:id` reflects the new role

#### Scenario: Admin resets a user's password
- **WHEN** an admin calls `PUT /users/:id` with body `{ password: "newPass!" }`
- **THEN** the response is HTTP 200
- **AND** the persisted `passwordHash` matches the new password under bcrypt
- **AND** a subsequent `POST /auth/login` with the new password succeeds

#### Scenario: Admin deletes a user
- **WHEN** an admin calls `DELETE /users/:id`
- **THEN** the response is HTTP 204
- **AND** the user is removed from any `campaigns.players` arrays

#### Scenario: Reading a missing user
- **WHEN** an admin calls `GET /users/:id` for an id that does not exist
- **THEN** the response is HTTP 404

### Requirement: Admin cannot delete themselves
The API SHALL reject any `DELETE /users/:id` request where `:id` equals the authenticated caller's id, returning HTTP 409.

#### Scenario: Self-deletion blocked
- **WHEN** an admin with id `admin-1` calls `DELETE /users/admin-1`
- **THEN** the response is HTTP 409 and the user is not deleted

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
