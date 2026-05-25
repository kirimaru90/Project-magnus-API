## MODIFIED Requirements

### Requirement: Listing terminals in a campaign
The API SHALL expose `GET /campaigns/:id/terminals` returning the terminals belonging to that campaign. The route SHALL apply the same access rules as `GET /campaigns/:id`: admin always; player only for assigned or public-active campaigns; anonymous only for public-active campaigns. Each terminal summary SHALL include `id`, `title`, `meta.public` (from content), and `viewCount` (the terminal's current view total, an integer defaulting to `0`), but SHALL NOT include the full `content` field.

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

## ADDED Requirements

### Requirement: Terminal view counting
Each terminal SHALL carry a server-owned `viewCount` integer that defaults to `0` on creation and is never accepted from client input. The API SHALL increment a terminal's `viewCount` by one each time the terminal is loaded for playback, namely on `GET /terminals/:id/load` and on `GET /campaigns/:id/terminals/by-hidden-id/:hiddenId`.

Admin-initiated loads SHALL be governed by a configuration flag (`terminals.countAdminViews`, sourced from the `TERMINAL_COUNT_ADMIN_VIEWS` environment variable) whose default is `false`:
- When the loading caller is an admin, `viewCount` SHALL increment only if `terminals.countAdminViews` is `true`.
- When the loading caller is a player or anonymous, `viewCount` SHALL always increment.

The `GET /terminals/:id` detail endpoint SHALL NOT increment `viewCount`. The increment SHALL NOT alter the load response payload contract (`{ content, localState, globalState }`).

#### Scenario: New terminal starts at zero
- **WHEN** an admin creates a terminal
- **THEN** the terminal's `viewCount` is `0`

#### Scenario: Player load by id increments the count
- **GIVEN** terminal T has `viewCount == 0`
- **WHEN** an assigned player calls `GET /terminals/T/load`
- **THEN** the response is HTTP 200
- **AND** T's `viewCount` becomes `1`

#### Scenario: Anonymous load by hiddenId increments the count
- **GIVEN** terminal T in an active public campaign C has `viewCount == 4` and `meta.hiddenId == "vault-101"` with `meta.public == false`
- **WHEN** an anonymous caller calls `GET /campaigns/C/terminals/by-hidden-id/vault-101`
- **THEN** the response is HTTP 200
- **AND** T's `viewCount` becomes `5`

#### Scenario: Admin load is not counted when the flag is disabled
- **GIVEN** `terminals.countAdminViews` is `false` and terminal T has `viewCount == 2`
- **WHEN** an admin calls `GET /terminals/T/load`
- **THEN** the response is HTTP 200
- **AND** T's `viewCount` remains `2`

#### Scenario: Admin load is counted when the flag is enabled
- **GIVEN** `terminals.countAdminViews` is `true` and terminal T has `viewCount == 2`
- **WHEN** an admin calls `GET /terminals/T/load`
- **THEN** the response is HTTP 200
- **AND** T's `viewCount` becomes `3`

#### Scenario: Admin load by hiddenId respects the flag
- **GIVEN** `terminals.countAdminViews` is `false` and terminal T (with `meta.public == false` and `meta.hiddenId == "vault-101"`) has `viewCount == 7`
- **WHEN** an admin calls `GET /campaigns/C/terminals/by-hidden-id/vault-101`
- **THEN** the response is HTTP 200
- **AND** T's `viewCount` remains `7`

#### Scenario: Detail endpoint does not increment
- **GIVEN** terminal T has `viewCount == 1`
- **WHEN** any authorized caller calls `GET /terminals/T`
- **THEN** T's `viewCount` remains `1`

#### Scenario: viewCount is server-owned on input
- **WHEN** an admin posts a terminal whose payload attempts to set `viewCount`
- **THEN** the created terminal's `viewCount` is `0` (client-supplied value is ignored)
