# terminals — addendum: meta.id slug lookup

This document extends the `terminals` spec from the `bootstrap-terminal-api` change. All existing requirements remain in force.

---

## Requirement: Unique meta.id within a campaign

Each terminal's `meta.id` (the human-readable slug embedded in `content.meta.id`) SHALL be unique within its campaign. The API SHALL enforce this at the database level via a compound unique index on `(campaignId, content.meta.id)`.

#### Scenario: Duplicate meta.id rejected on create
- **GIVEN** campaign C already contains a terminal with `content.meta.id == "vault-101"`
- **WHEN** an admin posts a new terminal to campaign C with the same `meta.id`
- **THEN** the response is HTTP 409

#### Scenario: Duplicate meta.id rejected on import
- **WHEN** an admin imports a terminal JSON into campaign C whose `meta.id` matches an existing terminal in C
- **THEN** the response is HTTP 409 and no new terminal is created

#### Scenario: Same meta.id allowed across different campaigns
- **WHEN** campaign C1 has a terminal with `meta.id == "vault-101"` and an admin creates a terminal in campaign C2 with `meta.id == "vault-101"`
- **THEN** the response is HTTP 201 (uniqueness is per-campaign, not global)

---

## Requirement: Hidden terminal lookup by meta.id

The API SHALL expose `GET /campaigns/:id/terminals/by-meta/:metaId` that resolves a `meta.id` slug to a playable terminal payload. The route SHALL:

- Apply the same access rules as `GET /campaigns/:id/terminals` (admin always; player only for assigned or public-active campaigns; anonymous only for public-active campaigns).
- Return HTTP 404 if no terminal with that `meta.id` exists in the campaign.
- Return HTTP 404 if the matching terminal has `meta.public === true` (this endpoint is exclusively for hidden terminals; absent `meta.public` is treated as `false`).
- On success, return the same payload as `GET /terminals/:id/load`: `{ content, localState, globalState }` with `content.login.users` always stripped.

#### Scenario: Player resolves a hidden terminal by meta.id in an assigned campaign
- **WHEN** a player assigned to campaign C calls `GET /campaigns/C/terminals/by-meta/vault-101`
- **AND** campaign C contains a terminal with `meta.id == "vault-101"` and `meta.public == false`
- **THEN** the response is HTTP 200 with `{ content, localState, globalState }`
- **AND** the response contains no `login.users` entries

#### Scenario: Absent meta.public treated as non-public (lookup succeeds)
- **WHEN** a terminal's content does not declare `meta.public` at all
- **AND** an authorized caller looks it up by `meta.id`
- **THEN** the response is HTTP 200 (absence of the field is treated as `false`)

#### Scenario: Public terminal not resolvable via this endpoint
- **WHEN** a terminal has `meta.public == true`
- **AND** a caller queries `GET /campaigns/C/terminals/by-meta/<that terminal's meta.id>`
- **THEN** the response is HTTP 404

#### Scenario: Anonymous caller resolves hidden terminal in a public-active campaign
- **WHEN** campaign C is `isActive == true` and `isPublic == true`
- **AND** it contains a terminal with `meta.id == "hidden-stash"` and `meta.public == false`
- **AND** an anonymous caller calls `GET /campaigns/C/terminals/by-meta/hidden-stash`
- **THEN** the response is HTTP 200

#### Scenario: Anonymous caller denied for private campaign
- **WHEN** campaign C is private (`isPublic == false`)
- **AND** an anonymous caller calls `GET /campaigns/C/terminals/by-meta/vault-101`
- **THEN** the response is HTTP 404

#### Scenario: Unknown meta.id
- **WHEN** no terminal in campaign C has `meta.id == "does-not-exist"`
- **AND** an authorized caller queries `GET /campaigns/C/terminals/by-meta/does-not-exist`
- **THEN** the response is HTTP 404
