## ADDED Requirements

### Requirement: Patch inventory items
The system SHALL expose `PATCH /campaigns/:cid/characters/:id/inventory` performing id-based diffing on the four item arrays. Each array is patched independently via an `{ items, deletedIds }` block; arrays omitted from the body are left untouched.

The body MAY contain any of `weapons`, `equip`, `consumables`, `other`, each shaped as:
- `items`: an item with `id` updates the matching item (unknown id is not applied and is reported in the response `ignored` array with reason `unknown_id`); an item without `id` is created and the server assigns a nanoid short string id
- `deletedIds`: array of ids to remove from that array

Item shapes:
- `weapons` / `equip`: `name` (required), `tags` array (optional), `broken` boolean (optional)
- `consumables` / `other`: `name` (required), `description` (optional), `quantity` number ≥ 0

Each tag object SHALL have `name` (string, required), `type` (enum: core | extra, required), and `damaged` (boolean, optional, default false).

Item ids SHALL be unique across all four arrays, including the ids the server assigns on create — a newly created item SHALL NOT receive an id already present in any of `weapons`, `equip`, `consumables`, or `other`. Inventory is **player-writable** (owner) and admin — owners have full create/update/delete.

#### Scenario: Owner adds an item
- **WHEN** the owner PATCHes `{ "weapons": { "items": [ { "name": "10mm Pistol" } ] } }`
- **THEN** a weapon SHALL be created with a server-assigned `id` and HTTP 200 returned with the updated `inventory` object as the response `section`

#### Scenario: Owner updates an item
- **WHEN** the owner PATCHes `{ "weapons": { "items": [ { "id": "a1b2", "broken": true } ] } }` for an existing item id
- **THEN** that item SHALL be merged and HTTP 200 returned

#### Scenario: Owner removes an item
- **WHEN** the owner PATCHes `{ "weapons": { "deletedIds": ["c3d4"] } }`
- **THEN** the matching weapon SHALL be removed and HTTP 200 returned

#### Scenario: Untouched arrays are preserved
- **WHEN** the body contains only a `weapons` block
- **THEN** `equip`, `consumables`, and `other` SHALL be unchanged

#### Scenario: Unknown item id is skipped and reported
- **WHEN** an item references an `id` not present in that array
- **THEN** that item SHALL NOT be applied, the response `ignored` array SHALL contain an entry naming that array and the offending id with reason `unknown_id`, and HTTP 200 SHALL be returned

#### Scenario: Created item ids never collide across arrays
- **WHEN** the owner creates one or more id-less items across any of the four arrays
- **THEN** every server-assigned id SHALL be unique across `weapons`, `equip`, `consumables`, and `other`, never duplicating an id already present in any of the four arrays

#### Scenario: Negative quantity
- **WHEN** a created or updated consumable or other item has `quantity` below 0
- **THEN** the system SHALL return HTTP 400

#### Scenario: Invalid tag type
- **WHEN** a tag has a `type` not in `['core', 'extra']`
- **THEN** the system SHALL return HTTP 400

#### Scenario: Created item missing name
- **WHEN** an id-less item omits the `name` field
- **THEN** the system SHALL return HTTP 400

### Requirement: Inventory endpoint enforces ownership
`PATCH /campaigns/:cid/characters/:id/inventory` SHALL enforce the same ownership rules as all other character endpoints: players may only patch their own characters; admins may patch any character in the campaign.

#### Scenario: Non-owner player calls inventory endpoint
- **WHEN** a player PATCHes the inventory of a character they do not own
- **THEN** the system SHALL return HTTP 404
