## ADDED Requirements

### Requirement: Patch SPECIAL stats
The system SHALL expose `PATCH /campaigns/:cid/characters/:id/special` performing a partial merge of the seven S.P.E.C.I.A.L. attributes. Only attributes present in the body are changed; omitted attributes are left untouched.

Each attribute (strength, perception, endurance, charisma, intelligence, agility, luck) SHALL be a number between 1 and 5 inclusive. SPECIAL is **admin-only**: a non-admin's writes to this section are silently discarded.

#### Scenario: Admin updates a subset of attributes
- **WHEN** an admin PATCHes `{ "strength": 4, "luck": 2 }`
- **THEN** only `strength` and `luck` SHALL change, the other five SHALL be unchanged, and HTTP 200 SHALL be returned with the updated `special` object as the response `section`

#### Scenario: Value out of range
- **WHEN** any provided attribute is below 1 or above 5
- **THEN** the system SHALL return HTTP 400

#### Scenario: Player write is ignored and reported
- **WHEN** a player (owner, non-admin) PATCHes any SPECIAL attribute
- **THEN** no attribute SHALL change, HTTP 200 SHALL be returned with the unchanged `special` object as the response `section`, and the `ignored` array SHALL report the `special` section as `disallowed_section`

### Requirement: Patch skills
The system SHALL expose `PATCH /campaigns/:cid/characters/:id/skills`. Skills are keyed by a caller-supplied catalog slug (`id`); ids are never server-minted.

The body MAY contain:
- `items`: array of skill objects, each with `id` (catalog slug, required) and `level` (enum: competent | expert | master)
- `deletedIds`: array of catalog slugs to detach

Patch semantics:
- an item whose `id` is not yet on the character SHALL be **inserted**
- an item whose `id` is already on the character SHALL be merged (level updated)
- a slug in `deletedIds` SHALL be detached
- an item missing `id` SHALL cause HTTP 400

Skills are **admin-only**.

#### Scenario: Admin attaches a new catalog skill
- **WHEN** an admin PATCHes `{ "items": [ { "id": "hacking", "level": "expert" } ] }` and the character has no `hacking` skill
- **THEN** `hacking` at level expert SHALL be added and HTTP 200 returned

#### Scenario: Admin changes an existing skill level
- **WHEN** an admin PATCHes `{ "items": [ { "id": "lockpick", "level": "master" } ] }` and the character already has `lockpick`
- **THEN** the `lockpick` level SHALL become master and HTTP 200 returned

#### Scenario: Admin detaches a skill
- **WHEN** an admin PATCHes `{ "deletedIds": ["barter"] }`
- **THEN** the `barter` skill SHALL be removed and HTTP 200 returned

#### Scenario: Skill item missing id
- **WHEN** any item in `items` has no `id`
- **THEN** the system SHALL return HTTP 400

#### Scenario: Invalid skill level
- **WHEN** an item has a `level` not in the allowed enum
- **THEN** the system SHALL return HTTP 400

#### Scenario: Player write is ignored and reported
- **WHEN** a player PATCHes skills
- **THEN** no skill SHALL change, HTTP 200 returned with the unchanged skills array as the response `section`, and the `ignored` array SHALL report the `skills` section as `disallowed_section`

### Requirement: Patch perks
The system SHALL expose `PATCH /campaigns/:cid/characters/:id/perks`. Perks are a collection with server-minted nanoid ids.

The body MAY contain:
- `items`: an item with `id` updates the matching perk (unknown id is not applied and is reported in the response `ignored` array with reason `unknown_id`); an item without `id` creates a perk and the server assigns a nanoid
- `deletedIds`: array of ids to remove

Each perk SHALL have `name` (required) and MAY have `description` and `icon`. Perks are **admin-only**.

#### Scenario: Admin creates a perk
- **WHEN** an admin PATCHes `{ "items": [ { "name": "Bloody Mess" } ] }`
- **THEN** a perk SHALL be created with a server-assigned `id` and HTTP 200 returned

#### Scenario: Admin updates a perk
- **WHEN** an admin PATCHes `{ "items": [ { "id": "a1b2c3d4", "description": "..." } ] }` for an existing perk id
- **THEN** that perk SHALL be merged and HTTP 200 returned

#### Scenario: Unknown perk id is skipped and reported
- **WHEN** an item references an `id` not present on the character
- **THEN** that item SHALL NOT be applied, the response `ignored` array SHALL contain an entry naming the perks section and that id with reason `unknown_id`, and HTTP 200 SHALL be returned

#### Scenario: Created perk missing name
- **WHEN** an id-less perk item omits `name`
- **THEN** the system SHALL return HTTP 400

#### Scenario: Player write is ignored and reported
- **WHEN** a player PATCHes perks
- **THEN** no perk SHALL change, HTTP 200 returned with the unchanged perks array as the response `section`, and the `ignored` array SHALL report the `perks` section as `disallowed_section`

### Requirement: Patch status
The system SHALL expose `PATCH /campaigns/:cid/characters/:id/status`. Status comprises two nanoid condition collections plus a scalar.

The body MAY contain any of:
- `positiveConditions`: `{ items, deletedIds }` collection of condition objects
- `negativeConditions`: `{ items, deletedIds }` collection of condition objects
- `criticalState`: boolean (partial-merge scalar)

Each condition SHALL have `name` (required), `severity` (enum: minor | major, default minor), and MAY have `description`. Condition ids are server-minted nanoids: id-less items are created, ids in `deletedIds` removed, unknown ids skipped. Status is **player-writable** (owner) and admin.

#### Scenario: Owner adds a condition
- **WHEN** the owner PATCHes `{ "negativeConditions": { "items": [ { "name": "Poisoned", "severity": "major" } ] } }`
- **THEN** a condition SHALL be added with a server-assigned id and HTTP 200 returned

#### Scenario: Owner removes a condition
- **WHEN** the owner PATCHes `{ "positiveConditions": { "deletedIds": ["k9l0m1n2"] } }`
- **THEN** the matching condition SHALL be removed and HTTP 200 returned

#### Scenario: Owner flips criticalState
- **WHEN** the owner PATCHes `{ "criticalState": true }`
- **THEN** `criticalState` SHALL become true and the condition arrays SHALL be unchanged

#### Scenario: Invalid condition severity
- **WHEN** a condition has a `severity` not in `['minor', 'major']`
- **THEN** the system SHALL return HTTP 400

### Requirement: Patch action points
The system SHALL expose `PATCH /campaigns/:cid/characters/:id/action-points` performing a partial merge of the action-point fields. Only fields present are changed.

Fields:
- `paMax`: number ≥ 0
- `paCurrent`: number ≥ 0
- `paTrackedBy`: enum agility | endurance

Players MAY write only `paCurrent`; `paMax` and `paTrackedBy` are admin-only (a player's writes to them are silently discarded).

#### Scenario: Player spends action points
- **WHEN** a player (owner) PATCHes `{ "paCurrent": 3 }`
- **THEN** `paCurrent` SHALL become 3 and HTTP 200 returned

#### Scenario: Player write to paMax is ignored
- **WHEN** a player PATCHes `{ "paMax": 10, "paCurrent": 3 }`
- **THEN** `paCurrent` SHALL change to 3, `paMax` SHALL be unchanged, and HTTP 200 returned

#### Scenario: Admin sets all fields
- **WHEN** an admin PATCHes `{ "paMax": 8, "paCurrent": 8, "paTrackedBy": "agility" }`
- **THEN** all three SHALL be updated and HTTP 200 returned

#### Scenario: Negative value
- **WHEN** `paMax` or `paCurrent` is negative
- **THEN** the system SHALL return HTTP 400

#### Scenario: Invalid paTrackedBy
- **WHEN** `paTrackedBy` is provided and not `agility` or `endurance`
- **THEN** the system SHALL return HTTP 400

### Requirement: Section endpoints return the mutated section and an ignored list
Every section PATCH endpoint SHALL respond with an envelope `{ section, ignored }`. The `section` value SHALL be only the mutated section (e.g. the `special` object, the `skills` array, the `status` object), never the full character document. The `ignored` value SHALL be an array listing every input the server dropped while partially applying the request; each entry SHALL identify the section, the offending field key or element id, and a reason code — one of `unauthorized_field`, `unknown_id`, or `disallowed_section`. When nothing was dropped, `ignored` SHALL be an empty array.

When a field is dropped with reason `unauthorized_field`, the returned `section` SHALL reflect the unchanged persisted value of that field, not the rejected input.

#### Scenario: Response contains the section and an ignored array
- **WHEN** any section PATCH succeeds
- **THEN** the response body SHALL be `{ section, ignored }` with HTTP 200, where `section` is the updated section value and `ignored` lists every dropped field or id (an empty array when nothing was dropped)

#### Scenario: Unauthorized field is reported and reflected unchanged
- **WHEN** a non-admin PATCHes a section including a field they are not permitted to write
- **THEN** the returned `section` SHALL show that field's unchanged persisted value, `ignored` SHALL contain an entry naming that section and field with reason `unauthorized_field`, and HTTP 200 SHALL be returned

### Requirement: Section endpoints enforce ownership
All section PATCH endpoints SHALL enforce the same ownership rules as the full character endpoints: players may only patch their own characters; admins may patch any character in the campaign. Field-level authorization (which sections/fields a non-admin may actually write) is applied after ownership, silently discarding unauthorized keys.

#### Scenario: Non-owner player calls a section endpoint
- **WHEN** a player PATCHes a section of a character they do not own
- **THEN** the system SHALL return HTTP 404
