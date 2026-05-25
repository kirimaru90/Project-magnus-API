# campaigns Specification

## Purpose

CRUD over campaigns, public/active toggles, player membership management, and listing rules for admin/player/anonymous callers.

## Requirements

### Requirement: Campaign listing is actor-dependent
The API SHALL expose `GET /campaigns`. The set of campaigns returned SHALL depend on the caller:
- **Admin**: all campaigns (active and inactive, public and private).
- **Authenticated player**: every campaign where `isActive == true` and (`isPublic == true` OR the player is in `players[]`).
- **Anonymous**: every campaign where `isActive == true` AND `isPublic == true`.

Each returned campaign SHALL include `id`, `name`, `isActive`, `isPublic`.

#### Scenario: Anonymous sees only active public campaigns
- **WHEN** `GET /campaigns` is called without a token, and the database contains: one active+public campaign C1, one active+private campaign C2, one inactive+public campaign C3
- **THEN** the response contains only C1

#### Scenario: Player sees public plus assigned active campaigns
- **WHEN** a player assigned to C2 calls `GET /campaigns` with the same database state as above
- **THEN** the response contains C1 and C2 but not C3

#### Scenario: Admin sees everything
- **WHEN** an admin calls `GET /campaigns`
- **THEN** the response contains C1, C2, and C3

### Requirement: Admin can create campaigns
The API SHALL expose `POST /campaigns` accepting `{ name, isActive?, isPublic? }` (booleans default to `false`). Response is HTTP 201 with the created campaign. Admin-only.

#### Scenario: Admin creates a campaign with defaults
- **WHEN** an admin calls `POST /campaigns` with `{ name: "Wasteland" }`
- **THEN** the response is HTTP 201 with a campaign object where `isActive == false`, `isPublic == false`, `players == []`, `state == {}`

#### Scenario: Player cannot create a campaign
- **WHEN** a player-role token calls `POST /campaigns`
- **THEN** the response is HTTP 403

### Requirement: Campaign detail respects access rules
The API SHALL expose `GET /campaigns/:id` returning `{ id, name, isActive, isPublic, players, state, createdAt, updatedAt }`. Admin sees everything. Players and anonymous see the campaign only if it is visible to them by the listing rules; otherwise 404 (not 403) to avoid leaking existence.

#### Scenario: Anonymous reads an active public campaign
- **WHEN** `GET /campaigns/C1` is called without a token, where C1 is active and public
- **THEN** the response is HTTP 200 with the campaign detail (no player list — anonymous callers receive `players: []` projection)

#### Scenario: Anonymous attempts to read a private campaign
- **WHEN** `GET /campaigns/C2` is called without a token, where C2 is private
- **THEN** the response is HTTP 404

#### Scenario: Player attempts to read an unassigned private campaign
- **WHEN** a player not assigned to C2 calls `GET /campaigns/C2`
- **THEN** the response is HTTP 404

### Requirement: Admin can update, delete, and toggle campaigns
The API SHALL expose `PUT /campaigns/:id` (admin), `DELETE /campaigns/:id` (admin), and `POST /campaigns/:id/activate` (admin) toggling `isActive`. `PUT` accepts any subset of `{ name, isActive, isPublic }`. `DELETE` cascades to the campaign's terminals and their fictional users.

#### Scenario: Admin renames a campaign
- **WHEN** an admin calls `PUT /campaigns/:id` with `{ name: "New Name" }`
- **THEN** the response is HTTP 200 with the updated campaign

#### Scenario: Admin toggles active state
- **WHEN** an admin calls `POST /campaigns/:id/activate` on a currently active campaign
- **THEN** the response is HTTP 200 and the campaign's `isActive` is now `false`
- **AND** anonymous callers no longer see this campaign in `GET /campaigns`

#### Scenario: Admin deletes a campaign
- **WHEN** an admin calls `DELETE /campaigns/:id`
- **THEN** the response is HTTP 204
- **AND** the campaign, all its terminals, and all associated fictional users are removed

### Requirement: Player membership management is admin-only
The API SHALL expose `GET /campaigns/:id/players`, `POST /campaigns/:id/players` (body `{ playerId }`), and `DELETE /campaigns/:id/players/:playerId`. All three SHALL be admin-only.

#### Scenario: Admin assigns a player
- **WHEN** an admin calls `POST /campaigns/:id/players` with `{ playerId: "u1" }` where `u1` exists with role `player`
- **THEN** the response is HTTP 201 and `u1` appears in the campaign's `players[]`

#### Scenario: Cannot assign an admin user
- **WHEN** an admin calls `POST /campaigns/:id/players` with a `playerId` whose user has role `admin`
- **THEN** the response is HTTP 400

#### Scenario: Removing a player
- **WHEN** an admin calls `DELETE /campaigns/:id/players/u1`
- **THEN** the response is HTTP 204 and `u1` is no longer in `players[]`

#### Scenario: Listing players requires admin
- **WHEN** a player or anonymous caller calls `GET /campaigns/:id/players`
- **THEN** the response is HTTP 403 (player) or HTTP 401 (anonymous)
