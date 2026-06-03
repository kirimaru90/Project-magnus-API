## ADDED Requirements

### Requirement: Patch resources
The system SHALL expose `PATCH /campaigns/:cid/characters/:id/resources` performing a partial merge of the three resource counters. Only counters present in the body are changed; omitted counters are left untouched.

Fields:
- `caps`: number ≥ 0
- `bobbleheads`: number ≥ 0
- `scraps`: number ≥ 0

Players MAY write only `caps` and `scraps`; `bobbleheads` is admin-only (a player's write to it is silently discarded).

#### Scenario: Player updates caps and scraps
- **WHEN** a player (owner) PATCHes `{ "caps": 120, "scraps": 8 }`
- **THEN** `caps` and `scraps` SHALL be updated, `bobbleheads` SHALL be unchanged, and HTTP 200 returned with the updated `resources` object as the response `section`

#### Scenario: Player write to bobbleheads is ignored and reported
- **WHEN** a player PATCHes `{ "bobbleheads": 5, "caps": 10 }`
- **THEN** `caps` SHALL change to 10, `bobbleheads` SHALL be unchanged, the returned `section` SHALL show the original `bobbleheads` count, and the `ignored` array SHALL contain an entry identifying the `resources` section and the `bobbleheads` field with reason `unauthorized_field`, with HTTP 200 returned

#### Scenario: Admin updates bobbleheads
- **WHEN** an admin PATCHes `{ "bobbleheads": 5 }`
- **THEN** `bobbleheads` SHALL become 5 and HTTP 200 returned

#### Scenario: Zero values allowed
- **WHEN** any provided counter is set to 0
- **THEN** the system SHALL accept the value and return HTTP 200

#### Scenario: Negative value
- **WHEN** any provided counter is below 0
- **THEN** the system SHALL return HTTP 400

### Requirement: Resources endpoint enforces ownership
`PATCH /campaigns/:cid/characters/:id/resources` SHALL enforce the same ownership rules as all other character endpoints: players may only patch their own characters; admins may patch any character in the campaign.

#### Scenario: Non-owner player calls resources endpoint
- **WHEN** a player PATCHes the resources of a character they do not own
- **THEN** the system SHALL return HTTP 404
