## MODIFIED Requirements

### Requirement: Admin can create terminals
The API SHALL expose `POST /campaigns/:id/terminals` accepting a JSON body that conforms to the terminal content schema (`meta`, `state`, optional `login`, `nodes`). The `meta` block accepts `{ title, hiddenId?, public? }` where `hiddenId` is optional. The field `content.meta.id` SHALL be rejected on input with HTTP 400 (clients may not override the server-assigned record id). The API SHALL:
- Validate the payload against the schema; reject with HTTP 400 if invalid.
- Reject with HTTP 400 if the payload contains `content.meta.id`.
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

#### Scenario: Client attempts to set meta.id on input
- **WHEN** an admin posts a terminal whose `content.meta` includes a non-empty `id` field
- **THEN** the response is HTTP 400 (`meta.id` is server-owned and not accepted on input)

### Requirement: Reading terminal detail and playback
The API SHALL expose two read endpoints for a terminal:

- `GET /terminals/:id` — returns the terminal record with `content` (stripped of any login user passwords), `state` (current values), `campaignId`, `title`. Visible per the campaign access rules.
- `GET /terminals/:id/load` — returns a playback payload: `{ content, localState, globalState }` where both state objects are flat `{ key: value }` maps. Designed for the Terminal client.

Neither route SHALL include fictional credentials in the response.

The terminal's `content.meta.id` SHALL NOT be persisted in the document. On all read paths, the service SHALL inject `content.meta.id = String(_id)` into the returned `content.meta` — the same identifier returned as the top-level `id` in list summaries — and SHALL return `content.meta.hiddenId` as stored (omitted when not set). This injection is applied to `GET /terminals/:id`, `GET /terminals/:id/load`, and the by-hidden-id lookup.

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

#### Scenario: meta.id injected on detail equals the mongo id
- **WHEN** any authorized caller reads `GET /terminals/T`
- **THEN** the response's `content.meta.id` equals the same string returned as the top-level `id`
- **AND** the response's `content.meta.hiddenId` equals the slug as stored

#### Scenario: meta.id injected on load equals the mongo id
- **WHEN** any authorized caller reads `GET /terminals/T/load`
- **THEN** the response's `content.meta.id` equals `String(_id)` of terminal T

### Requirement: Terminal export
The API SHALL expose `POST /terminals/:id/export` (admin) returning a self-contained JSON document including the terminal's `content` plus its `login.users` reconstituted from the `fictionalUsers` collection. The output JSON SHALL be importable via the import endpoint.

The exported `content.meta` SHALL contain `{ title, public?, hiddenId? }` (with `hiddenId` present only if the source terminal had one). The synthetic `content.meta.id` (injected on read paths) SHALL be stripped from the export payload so the JSON is round-trippable through `import` (which rejects `meta.id`).

#### Scenario: Round-trip export → import
- **WHEN** an admin exports terminal T1 from campaign C1 and imports the resulting JSON into a new campaign C2
- **THEN** C2 contains a terminal whose content matches T1's, whose fictional users match T1's, and whose state is initialized to defaults

#### Scenario: Export strips meta.id
- **WHEN** an admin exports a terminal
- **THEN** the resulting JSON's `content.meta` contains `hiddenId` but no `id` field

### Requirement: Terminal import
The API SHALL expose `POST /campaigns/:id/terminals/import` (admin) accepting JSON conforming to the terminal content schema. Import always **creates** a new terminal; it never overwrites an existing one. Validation, fictional-user extraction, and state projection rules match those of `POST /campaigns/:id/terminals`. Global state collisions follow first-declaration-wins (existing campaign values preserved). The input MAY carry `content.meta.hiddenId` (optional); the field `content.meta.id` is rejected on input with HTTP 400.

#### Scenario: Successful import
- **WHEN** an admin imports a valid terminal JSON into a campaign
- **THEN** the response is HTTP 201 with the created terminal summary

#### Scenario: Invalid JSON rejected
- **WHEN** an admin imports a JSON document that does not conform to the schema (e.g., missing `meta.title`)
- **THEN** the response is HTTP 400 and no terminal is created

#### Scenario: Import payload containing meta.id rejected
- **WHEN** an admin imports a JSON document whose `content.meta` contains an `id` field
- **THEN** the response is HTTP 400 and no terminal is created

## REMOVED Requirements

### Requirement: Unique meta.id within a campaign
**Reason**: Renamed and reframed — uniqueness now applies to `meta.hiddenId`. See ADDED requirement "Unique hiddenId within a campaign".
**Migration**: Run `api/scripts/migrate-hidden-id.ts` to `$rename` `content.meta.id` → `content.meta.hiddenId` and drop the old compound index. The new compound index on `(campaignId, content.meta.hiddenId)` is created by Mongoose on app boot.

### Requirement: Hidden terminal lookup by meta.id
**Reason**: Endpoint and field renamed. See ADDED requirement "Hidden terminal lookup by hiddenId".
**Migration**: Clients calling `GET /campaigns/:id/terminals/by-meta/:metaId` MUST switch to `GET /campaigns/:id/terminals/by-hidden-id/:hiddenId`. The semantics, access rules, and response shape are unchanged.

## ADDED Requirements

### Requirement: Unique hiddenId within a campaign (when set)

When set, each terminal's `meta.hiddenId` (the human-readable slug embedded in `content.meta.hiddenId`) SHALL be unique within its campaign. `hiddenId` is optional; the uniqueness constraint applies only to terminals where `content.meta.hiddenId` is a string. The API SHALL enforce this at the database level via a **partial** compound unique index on `(campaignId, content.meta.hiddenId)` whose `partialFilterExpression` matches documents where `content.meta.hiddenId` is of type `string`.

#### Scenario: Duplicate hiddenId rejected on create
- **GIVEN** campaign C already contains a terminal with `content.meta.hiddenId == "vault-101"`
- **WHEN** an admin posts a new terminal to campaign C with the same `hiddenId`
- **THEN** the response is HTTP 409

#### Scenario: Duplicate hiddenId rejected on import
- **WHEN** an admin imports a terminal JSON into campaign C whose `meta.hiddenId` matches an existing terminal in C
- **THEN** the response is HTTP 409 and no new terminal is created

#### Scenario: Same hiddenId allowed across different campaigns
- **WHEN** campaign C1 has a terminal with `meta.hiddenId == "vault-101"` and an admin creates a terminal in campaign C2 with `meta.hiddenId == "vault-101"`
- **THEN** the response is HTTP 201 (uniqueness is per-campaign, not global)

#### Scenario: Multiple terminals without hiddenId allowed in the same campaign
- **GIVEN** campaign C already contains a terminal whose `content.meta` does not declare `hiddenId`
- **WHEN** an admin posts another terminal to campaign C whose `content.meta` also does not declare `hiddenId`
- **THEN** the response is HTTP 201 (the partial index excludes hiddenId-less documents from the uniqueness constraint)

### Requirement: Hidden terminal lookup by hiddenId

The API SHALL expose `GET /campaigns/:id/terminals/by-hidden-id/:hiddenId` that resolves a `meta.hiddenId` slug to a playable terminal payload. The route SHALL:

- Apply the same access rules as `GET /campaigns/:id/terminals` (admin always; player only for assigned or public-active campaigns; anonymous only for public-active campaigns).
- Return HTTP 404 if no terminal with that `hiddenId` exists in the campaign.
- Return HTTP 404 if the matching terminal has `meta.public === true` (this endpoint is exclusively for hidden terminals; absent `meta.public` is treated as `false`).
- On success, return the same payload as `GET /terminals/:id/load`: `{ content, localState, globalState }` with `content.login.users` always stripped and `content.meta.id` injected as `String(_id)`.

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
