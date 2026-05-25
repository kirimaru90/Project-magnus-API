## ADDED Requirements

### Requirement: Listing terminals in a campaign
The API SHALL expose `GET /campaigns/:id/terminals` returning the terminals belonging to that campaign. The route SHALL apply the same access rules as `GET /campaigns/:id`: admin always; player only for assigned or public-active campaigns; anonymous only for public-active campaigns. Each terminal summary SHALL include `id`, `title`, `meta.public` (from content), but SHALL NOT include the full `content` field.

#### Scenario: Player lists terminals in an assigned campaign
- **WHEN** a player assigned to campaign C calls `GET /campaigns/C/terminals`
- **THEN** the response is HTTP 200 with an array of terminal summaries

#### Scenario: Anonymous lists terminals in a private campaign
- **WHEN** an anonymous caller calls `GET /campaigns/C/terminals` for a private campaign C
- **THEN** the response is HTTP 404

### Requirement: Admin can create terminals
The API SHALL expose `POST /campaigns/:id/terminals` accepting a JSON body that conforms to the terminal content schema (`meta`, `state`, optional `login`, `nodes`). The API SHALL:
- Validate the payload against the schema; reject with HTTP 400 if invalid.
- Extract `login.users` (if any) and persist them in the `fictionalUsers` collection (one document per user, plaintext password).
- Persist the terminal with `content` containing everything *except* `login.users`.
- Initialize the terminal's `state` map by copying each `state.local` declaration into `{ type, value: default, default }`.
- Merge `state.global` declarations into the parent campaign's `state` only for keys that do not already exist (first-declaration-wins).

#### Scenario: Admin creates a terminal with local and global state
- **WHEN** an admin posts a terminal whose content declares `state.local.foo: {type:"boolean",default:false}` and `state.global.omega: {type:"boolean",default:false}` to a campaign with no existing `omega`
- **THEN** the response is HTTP 201
- **AND** the persisted terminal has `state.foo == {type:"boolean", value:false, default:false}`
- **AND** the parent campaign now has `state.omega == {type:"boolean", value:false, default:false}`

#### Scenario: First-declaration-wins on global state
- **WHEN** an admin imports a terminal declaring `state.global.omega: {default:true}` into a campaign whose `state.omega.value` is already `false`
- **THEN** the campaign's `state.omega.value` remains `false`

#### Scenario: Login users are stripped from stored content
- **WHEN** an admin posts a terminal whose content contains `login.users: [{username:"u",password:"p"}]`
- **THEN** the persisted terminal's `content.login` either omits `users` or has it as an empty array
- **AND** the `fictionalUsers` collection contains a row `{terminalId, username:"u", password:"p"}`

#### Scenario: Invalid content schema
- **WHEN** an admin posts a terminal with no `nodes` object
- **THEN** the response is HTTP 400

### Requirement: Reading terminal detail and playback
The API SHALL expose two read endpoints for a terminal:

- `GET /terminals/:id` — returns the terminal record with `content` (stripped of any login user passwords), `state` (current values), `campaignId`, `title`. Visible per the campaign access rules.
- `GET /terminals/:id/load` — returns a playback payload: `{ content, localState, globalState }` where both state objects are flat `{ key: value }` maps. Designed for the Terminal client.

Neither route SHALL include fictional credentials in the response.

#### Scenario: Player loads a terminal in an assigned campaign
- **WHEN** a player calls `GET /terminals/T/load` where T belongs to a campaign assigned to them
- **THEN** the response is HTTP 200 with `content`, `localState`, `globalState`
- **AND** the response body contains no `login.users[].password` anywhere

#### Scenario: Anonymous loads a terminal in a public campaign
- **WHEN** an anonymous caller calls `GET /terminals/T/load` where T's campaign is active+public
- **THEN** the response is HTTP 200

#### Scenario: Hidden access
- **WHEN** an anonymous caller calls `GET /terminals/T/load` where T's campaign is private
- **THEN** the response is HTTP 404

#### Scenario: Admin sees fictional credentials on detail (not on load)
- **WHEN** an admin calls `GET /terminals/T` for a terminal with fictional users
- **THEN** the response includes `fictionalUsers: [{username, password}, ...]`

#### Scenario: Non-admin never sees fictional credentials on detail
- **WHEN** a player calls `GET /terminals/T`
- **THEN** the response contains no `fictionalUsers` field

### Requirement: Updating and deleting terminals
The API SHALL expose `PUT /terminals/:id` (admin) and `DELETE /terminals/:id` (admin).

`PUT` accepts the same shape as create. The API SHALL:
- Re-validate against the schema.
- Re-extract fictional users and replace the `fictionalUsers` rows for this terminal.
- Re-project `state.local` declarations onto the terminal's `state` map with **additive semantics**: keys present in the new declaration but missing from the existing state are added with their defaults; keys present in both keep their current `value`; keys present in the existing state but not in the new declaration are left untouched (orphaned, not deleted).
- Re-project `state.global` declarations onto the campaign's `state` with the same first-declaration-wins rule (new globals added with defaults; existing globals untouched).

`DELETE` removes the terminal, its `fictionalUsers` rows, and any `terminals.state` data (campaign-level global state is **not** affected).

#### Scenario: Admin updates a terminal preserving live state
- **WHEN** a terminal has `state.access_count.value == 7` and an admin PUTs new content whose `state.local.access_count` declaration is unchanged
- **THEN** the response is HTTP 200 and the terminal's `state.access_count.value` is still `7`

#### Scenario: Adding a new local variable on update
- **WHEN** an admin PUTs new content adding `state.local.new_var: {type:"number", default:0}` to an existing terminal
- **THEN** the terminal's `state.new_var` is now `{type:"number", value:0, default:0}`

#### Scenario: Removing a variable from the schema is non-destructive
- **WHEN** an admin PUTs new content that no longer declares `state.local.old_var`
- **THEN** the terminal's `state.old_var` remains in the persisted state map until an explicit reset

#### Scenario: Admin deletes a terminal
- **WHEN** an admin calls `DELETE /terminals/:id`
- **THEN** the response is HTTP 204
- **AND** the terminal and its `fictionalUsers` rows are removed

### Requirement: Terminal export
The API SHALL expose `POST /terminals/:id/export` (admin) returning a self-contained JSON document including the terminal's `content` plus its `login.users` reconstituted from the `fictionalUsers` collection. The output JSON SHALL be importable via the import endpoint.

#### Scenario: Round-trip export → import
- **WHEN** an admin exports terminal T1 from campaign C1 and imports the resulting JSON into a new campaign C2
- **THEN** C2 contains a terminal whose content matches T1's, whose fictional users match T1's, and whose state is initialized to defaults

### Requirement: Terminal import
The API SHALL expose `POST /campaigns/:id/terminals/import` (admin) accepting JSON conforming to the terminal content schema. Import always **creates** a new terminal; it never overwrites an existing one. Validation, fictional-user extraction, and state projection rules match those of `POST /campaigns/:id/terminals`. Global state collisions follow first-declaration-wins (existing campaign values preserved).

#### Scenario: Successful import
- **WHEN** an admin imports a valid terminal JSON into a campaign
- **THEN** the response is HTTP 201 with the created terminal summary

#### Scenario: Invalid JSON rejected
- **WHEN** an admin imports a JSON document that does not conform to the schema (e.g., missing `meta.id`)
- **THEN** the response is HTTP 400 and no terminal is created

### Requirement: Fictional login validation
The API SHALL expose `POST /terminals/:id/fictional-login` accepting `{ username, password }`. The API SHALL match the supplied credentials against the `fictionalUsers` rows for that terminal (plaintext comparison, by design). The route SHALL be accessible to any caller who can read the terminal (admin / assigned player / anonymous on public campaigns).

#### Scenario: Successful fictional login
- **WHEN** a caller posts the correct username and password for a fictional user of terminal T
- **THEN** the response is HTTP 200 with body `{ ok: true, username }`

#### Scenario: Failed fictional login
- **WHEN** a caller posts an incorrect password
- **THEN** the response is HTTP 401 with a generic error

#### Scenario: Anonymous fictional login on public campaign
- **WHEN** an anonymous caller posts valid fictional credentials for a terminal in an active public campaign
- **THEN** the response is HTTP 200
