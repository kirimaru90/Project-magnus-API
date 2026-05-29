# terminals Specification

## Purpose

CRUD over terminals scoped to a campaign, JSON import/export with schema validation, content delivery with fictional-credential stripping, and fictional login validation.

## Requirements

### Requirement: Listing terminals in a campaign
The API SHALL expose `GET /campaigns/:id/terminals` returning the terminals belonging to that campaign. The route SHALL apply the same campaign-level access rules as `GET /campaigns/:id`: admin always; player only for assigned or public-active campaigns; anonymous only for public-active campaigns.

Within an accessible campaign, the returned row set SHALL be filtered as follows:

- Admin callers SHALL receive every terminal in the campaign.
- Player and anonymous callers SHALL receive only those terminals where either `content.meta.public === true` OR the terminal's `content.meta.hiddenId` is a member of the caller's `unlockedHiddenIds.<campaignId>` array. Anonymous callers (no user document) are equivalent to a player with an empty unlock list, so they receive only terminals with `content.meta.public === true`.

Each terminal summary returned SHALL include `id`, `campaignId`, `title`, `isPublic` (mirroring `content.meta.public`, defaulting to `false` when absent), `viewCount` (server-owned integer defaulting to `0`), `createdAt`, `updatedAt`, and OPTIONALLY `hiddenId` — present when the row's `content.meta.hiddenId` is a string and omitted otherwise. The summary SHALL NOT include the full `content` field.

The list endpoint SHALL NOT mutate `lastCampaignId` or any other user-document field on the caller's behalf.

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

#### Scenario: Admin sees all terminals regardless of visibility
- **GIVEN** campaign C contains a public terminal T1 and a private (`meta.public == false`) terminal T2 with `hiddenId == "vault-101"`
- **WHEN** an admin calls `GET /campaigns/C/terminals`
- **THEN** the response array contains summaries for both T1 and T2

#### Scenario: Player without unlock does not see a private terminal
- **GIVEN** campaign C contains a public terminal T1 and a private terminal T2 with `hiddenId == "vault-101"`
- **AND** assigned player U has `unlockedHiddenIds.C == []`
- **WHEN** U calls `GET /campaigns/C/terminals`
- **THEN** the response array contains a summary for T1 but no summary for T2

#### Scenario: Player with matching unlock sees the private terminal
- **GIVEN** campaign C contains private terminal T2 with `hiddenId == "vault-101"`
- **AND** assigned player U has `unlockedHiddenIds.C` containing `"vault-101"`
- **WHEN** U calls `GET /campaigns/C/terminals`
- **THEN** the response array contains a summary for T2

#### Scenario: hiddenId field present on summary when set
- **GIVEN** terminal T has `content.meta.hiddenId == "vault-101"`
- **AND** the caller sees T in the list response (admin, or player with matching unlock)
- **THEN** T's summary contains `hiddenId: "vault-101"`

#### Scenario: hiddenId field omitted on summary when absent
- **GIVEN** terminal T has no `content.meta.hiddenId`
- **WHEN** the caller sees T in the list response
- **THEN** T's summary does not contain a `hiddenId` key (or contains it as `null` — implementations MAY use either, but the field SHALL NOT be a stray non-slug string)

#### Scenario: Anonymous caller in public-active campaign sees only public terminals
- **GIVEN** campaign C is `isPublic == true` and `isActive == true` and contains a public terminal T1 and a private terminal T2
- **WHEN** an anonymous caller calls `GET /campaigns/C/terminals`
- **THEN** the response array contains a summary for T1 but no summary for T2

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

### Requirement: State variable declarations are validated on write

The API SHALL deep-validate every declared state variable in
`content.state.local` and `content.state.global` at write time on
`POST /campaigns/:id/terminals`, `POST /campaigns/:id/terminals/import`, and
`PUT /terminals/:id`, rejecting malformed declarations with HTTP 400 rather than
deferring the error to mutation time. For each declaration the API SHALL
enforce the following rules.

- `type` MUST be one of `boolean`, `number`, `enum`, or `string`; any other
  value is rejected with HTTP 400.
- When `type == "enum"`, `values` MUST be present and MUST be a non-empty array
  of strings; a missing, empty, or non-string-array `values` is rejected with
  HTTP 400.
- When `values` is present, every element MUST be a string.

The API SHALL NOT validate that an enum's `default` is one of its `values` (out
of scope). Validation SHALL occur at write time, not deferred to mutation time,
and the error message SHALL identify the offending variable.

#### Scenario: Enum declaration without values rejected on create
- **WHEN** an admin posts a terminal declaring `state.local.mood: {type:"enum", default:"calm"}` with no `values`
- **THEN** the response is HTTP 400 and no terminal is created

#### Scenario: Enum declaration without values rejected on import
- **WHEN** an admin imports a terminal JSON declaring an enum variable with no `values` array
- **THEN** the response is HTTP 400 and no terminal is created

#### Scenario: Enum declaration without values rejected on update
- **WHEN** an admin PUTs content declaring `state.global.phase: {type:"enum", default:"a"}` with no `values`
- **THEN** the response is HTTP 400 and the terminal is unchanged

#### Scenario: Enum declaration with a non-empty values array accepted
- **WHEN** an admin posts a terminal declaring `state.local.mood: {type:"enum", values:["calm","panicked"], default:"calm"}`
- **THEN** the response is HTTP 201

#### Scenario: Invalid variable type rejected
- **WHEN** an admin posts a terminal declaring `state.local.x: {type:"date", default:null}`
- **THEN** the response is HTTP 400 (only boolean/number/enum/string are allowed)

### Requirement: State blocks are optional and default to empty

The `content.state` block and each of its `local` and `global` sub-blocks SHALL
be optional on create, import, and update, and any omitted scope SHALL project
to an empty state map (`{}`) without failing the operation or persisting `null`.
A terminal submitted with no `state` key, with only `state.local`, or with only
`state.global` SHALL be accepted on `POST /campaigns/:id/terminals`,
`POST /campaigns/:id/terminals/import`, and `PUT /terminals/:id`.

#### Scenario: Create with no state block
- **WHEN** an admin posts a terminal whose content has `meta` and `nodes` but no `state` key
- **THEN** the response is HTTP 201
- **AND** the persisted terminal's local `state` map is `{}`

#### Scenario: Create with only local state
- **WHEN** an admin posts a terminal declaring `state.local.foo` but no `state.global`
- **THEN** the response is HTTP 201
- **AND** the parent campaign's global `state` is not modified

#### Scenario: Create with only global state
- **WHEN** an admin posts a terminal declaring `state.global.omega` but no `state.local`
- **THEN** the response is HTTP 201
- **AND** the persisted terminal's local `state` map is `{}`

#### Scenario: Update with no state block
- **WHEN** an admin PUTs content with no `state` key to an existing terminal
- **THEN** the response is HTTP 200 and the terminal's existing `state` values are left untouched

### Requirement: Unique hiddenId within a campaign (when set)

When set, each terminal's `meta.hiddenId` (the human-readable slug embedded in `content.meta.hiddenId`) SHALL be unique within its campaign. `hiddenId` is optional; the uniqueness constraint applies only to terminals where `content.meta.hiddenId` is a string. The API SHALL enforce this at the database level via a **partial** compound unique index on `(campaignId, content.meta.hiddenId)` whose `partialFilterExpression` matches documents where `content.meta.hiddenId` is of type `string`. A uniqueness violation raised by the database (duplicate-key error) SHALL be translated into an HTTP 409 response whose message names the conflicting slug; it SHALL NOT surface as an unhandled HTTP 500. This translation applies to create, import, and update.

#### Scenario: Duplicate hiddenId rejected on create
- **GIVEN** campaign C already contains a terminal with `content.meta.hiddenId == "vault-101"`
- **WHEN** an admin posts a new terminal to campaign C with the same `hiddenId`
- **THEN** the response is HTTP 409

#### Scenario: Duplicate hiddenId rejected on import
- **WHEN** an admin imports a terminal JSON into campaign C whose `meta.hiddenId` matches an existing terminal in C
- **THEN** the response is HTTP 409 and no new terminal is created

#### Scenario: Duplicate hiddenId rejected on update
- **GIVEN** campaign C contains terminals T1 with `hiddenId == "vault-101"` and T2 with a different or absent `hiddenId`
- **WHEN** an admin PUTs content to T2 setting `meta.hiddenId == "vault-101"`
- **THEN** the response is HTTP 409 and T2 is unchanged

#### Scenario: Same hiddenId allowed across different campaigns
- **WHEN** campaign C1 has a terminal with `meta.hiddenId == "vault-101"` and an admin creates a terminal in campaign C2 with `meta.hiddenId == "vault-101"`
- **THEN** the response is HTTP 201 (uniqueness is per-campaign, not global)

#### Scenario: Multiple terminals without hiddenId allowed in the same campaign
- **GIVEN** campaign C already contains a terminal whose `content.meta` does not declare `hiddenId`
- **WHEN** an admin posts another terminal to campaign C whose `content.meta` also does not declare `hiddenId`
- **THEN** the response is HTTP 201 (the partial index excludes hiddenId-less documents from the uniqueness constraint)

---

### Requirement: Hidden terminal lookup by hiddenId

The API SHALL expose `GET /campaigns/:id/terminals/by-hidden-id/:hiddenId` that resolves a `meta.hiddenId` slug to a playable terminal payload. The route SHALL:

- Apply the same access rules as `GET /campaigns/:id/terminals` (admin always; player only for assigned or public-active campaigns; anonymous only for public-active campaigns).
- Return HTTP 404 if no terminal with that `hiddenId` exists in the campaign.
- Return HTTP 404 if the matching terminal has `meta.public === true` (this endpoint is exclusively for hidden terminals; absent `meta.public` is treated as `false`).
- On success, return the same payload as `GET /terminals/:id/load`: `{ content, localState, globalState }` with `content.login.users` always stripped and `content.meta.id` injected as `String(_id)`.

On a successful resolution, the route SHALL apply the following user-state side effects:

- For any authenticated caller (admin or player), SHALL `$set` the caller's `user.lastCampaignId` to the campaign id of the resolved terminal.
- For player callers only, SHALL `$addToSet` the `hiddenId` into `user.unlockedHiddenIds.<campaignId>`. Admin callers SHALL NOT have their `unlockedHiddenIds` modified.
- Anonymous callers (no user document) SHALL NOT trigger any user-document write.

On a 404 response, if the caller is authenticated and the caller's `user.unlockedHiddenIds.<campaignId>` array contains the requested `hiddenId`, the route SHALL `$pull` that `hiddenId` from the array before returning the 404. This self-heal removes residual entries left by missed cascades (e.g., terminal deleted while the user was offline, or a terminal's `hiddenId` changed via update).

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

#### Scenario: Player unlock recorded on successful resolution
- **GIVEN** player U has `unlockedHiddenIds.C == []`
- **AND** campaign C contains a terminal with `meta.hiddenId == "vault-101"` and `meta.public == false`
- **WHEN** U calls `GET /campaigns/C/terminals/by-hidden-id/vault-101`
- **THEN** the response is HTTP 200
- **AND** U's persisted `unlockedHiddenIds.C` now contains `"vault-101"`

#### Scenario: Repeated successful resolution does not duplicate the unlock
- **GIVEN** player U has `unlockedHiddenIds.C == ["vault-101"]`
- **WHEN** U calls `GET /campaigns/C/terminals/by-hidden-id/vault-101` again successfully
- **THEN** U's persisted `unlockedHiddenIds.C` still equals `["vault-101"]` (no duplicate)

#### Scenario: Admin resolution does not record an unlock
- **GIVEN** admin A has `unlockedHiddenIds.C == []`
- **AND** campaign C contains a terminal with `meta.hiddenId == "vault-101"` and `meta.public == false`
- **WHEN** A calls `GET /campaigns/C/terminals/by-hidden-id/vault-101`
- **THEN** the response is HTTP 200
- **AND** A's persisted `unlockedHiddenIds.C` is still `[]`

#### Scenario: lastCampaignId set on successful resolution (player)
- **GIVEN** player U has `lastCampaignId == null`
- **WHEN** U calls `GET /campaigns/C/terminals/by-hidden-id/vault-101` successfully
- **THEN** U's persisted `lastCampaignId` equals `"C"` after the call

#### Scenario: lastCampaignId set on successful resolution (admin)
- **GIVEN** admin A has `lastCampaignId == "C-other"`
- **WHEN** A calls `GET /campaigns/C/terminals/by-hidden-id/vault-101` successfully
- **THEN** A's persisted `lastCampaignId` equals `"C"` after the call

#### Scenario: Anonymous caller writes nothing
- **WHEN** an anonymous caller resolves a hidden terminal in a public-active campaign successfully
- **THEN** no user document is created or modified by the call

#### Scenario: Stale unlock self-heals on 404
- **GIVEN** player U has `unlockedHiddenIds.C == ["vault-101"]`
- **AND** no terminal with `hiddenId == "vault-101"` currently exists in campaign C
- **WHEN** U calls `GET /campaigns/C/terminals/by-hidden-id/vault-101`
- **THEN** the response is HTTP 404
- **AND** U's persisted `unlockedHiddenIds.C` no longer contains `"vault-101"`

#### Scenario: Public-terminal 404 self-heals stale unlock entries
- **GIVEN** player U has `unlockedHiddenIds.C == ["vault-101"]`
- **AND** the terminal with `hiddenId == "vault-101"` in campaign C has been switched to `meta.public == true`
- **WHEN** U calls `GET /campaigns/C/terminals/by-hidden-id/vault-101`
- **THEN** the response is HTTP 404 (this endpoint never serves public terminals)
- **AND** U's persisted `unlockedHiddenIds.C` no longer contains `"vault-101"`

### Requirement: Non-public terminal access requires unlock

For every terminal route protected by `TerminalAccessGuard` — namely `GET /terminals/:id`, `GET /terminals/:id/load`, `POST /terminals/:id/fictional-login`, `GET /terminals/:id/state`, and `POST /terminals/:id/state/mutate` — the guard SHALL enforce, in addition to existing campaign-level access:

- Admin callers SHALL pass unconditionally (subject to existing campaign access).
- For all other callers (player or anonymous), if the target terminal has `content.meta.public !== true`, the guard SHALL require that the caller's `user.unlockedHiddenIds.<campaignId>` array contain the terminal's `content.meta.hiddenId`. Otherwise the guard SHALL deny with HTTP 404 (consistent with the existing "404 over 403" convention used to avoid leaking existence).
- Anonymous callers (no user document) SHALL NOT pass the privacy check for any non-public terminal.

A non-public terminal whose `content.meta` does not define a `hiddenId` SHALL be accessible only to admin callers via these routes (no path exists for a player to record an unlock for a hidden-id-less terminal).

The privacy check SHALL NOT increment `viewCount`, write `lastCampaignId`, or modify `unlockedHiddenIds`; it is a read-only gate. (Side-effects on success remain governed by their owning route's spec.)

#### Scenario: Admin loads a private terminal directly by id
- **GIVEN** terminal T has `meta.public == false` and `meta.hiddenId == "vault-101"` and belongs to campaign C
- **WHEN** an admin calls `GET /terminals/T/load`
- **THEN** the response is HTTP 200

#### Scenario: Player without unlock denied direct load
- **GIVEN** terminal T has `meta.public == false` and `meta.hiddenId == "vault-101"` and belongs to campaign C
- **AND** assigned player U has `unlockedHiddenIds.C == []`
- **WHEN** U calls `GET /terminals/T/load`
- **THEN** the response is HTTP 404

#### Scenario: Player with unlock allowed direct load
- **GIVEN** terminal T has `meta.public == false` and `meta.hiddenId == "vault-101"` and belongs to campaign C
- **AND** assigned player U has `unlockedHiddenIds.C` containing `"vault-101"`
- **WHEN** U calls `GET /terminals/T/load`
- **THEN** the response is HTTP 200

#### Scenario: Player with unlock allowed direct detail
- **GIVEN** terminal T has `meta.public == false` and `meta.hiddenId == "vault-101"` and belongs to campaign C
- **AND** assigned player U has `unlockedHiddenIds.C` containing `"vault-101"`
- **WHEN** U calls `GET /terminals/T`
- **THEN** the response is HTTP 200

#### Scenario: Player without unlock denied state read
- **GIVEN** terminal T has `meta.public == false` and `meta.hiddenId == "vault-101"`
- **AND** assigned player U has no entry for that hiddenId in `unlockedHiddenIds`
- **WHEN** U calls `GET /terminals/T/state`
- **THEN** the response is HTTP 404

#### Scenario: Player without unlock denied state mutation
- **GIVEN** terminal T has `meta.public == false` and `meta.hiddenId == "vault-101"`
- **AND** assigned player U has no entry for that hiddenId in `unlockedHiddenIds`
- **WHEN** U calls `POST /terminals/T/state/mutate` with a valid mutation body
- **THEN** the response is HTTP 404 and no state mutation is recorded

#### Scenario: Player without unlock denied fictional login
- **GIVEN** terminal T has `meta.public == false` and `meta.hiddenId == "vault-101"`
- **AND** assigned player U has no entry for that hiddenId in `unlockedHiddenIds`
- **WHEN** U calls `POST /terminals/T/fictional-login` with valid fictional credentials
- **THEN** the response is HTTP 404

#### Scenario: Public terminal accessible without unlock
- **GIVEN** terminal T has `meta.public == true`
- **WHEN** any assigned player or anonymous caller (subject to campaign access) calls `GET /terminals/T/load`
- **THEN** the response is HTTP 200 regardless of `unlockedHiddenIds`

#### Scenario: Private hidden-id-less terminal is admin-only
- **GIVEN** terminal T has `meta.public == false` and no `meta.hiddenId`
- **WHEN** any non-admin caller calls `GET /terminals/T/load`
- **THEN** the response is HTTP 404 (no unlock path exists for this terminal)

#### Scenario: Anonymous caller denied private terminal access
- **GIVEN** terminal T has `meta.public == false` and `meta.hiddenId == "vault-101"` in public-active campaign C
- **WHEN** an anonymous caller calls `GET /terminals/T/load`
- **THEN** the response is HTTP 404 (anonymous callers have no unlocks)

### Requirement: Terminal load records last campaign

The route `GET /terminals/:id/load` SHALL, on a successful (HTTP 200) load, `$set` the authenticated caller's `user.lastCampaignId` to the loaded terminal's `campaignId`, for both admin and player callers. Anonymous callers (no user document) SHALL NOT trigger any user-document write. The write SHALL occur regardless of whether `viewCount` is incremented (the two are independently governed).

The write SHALL apply equally to direct loads of public and non-public terminals — any successful load updates the field.

The load response payload contract (`{ content, localState, globalState }`) SHALL NOT change.

#### Scenario: Player load updates lastCampaignId
- **GIVEN** player U has `lastCampaignId == null`
- **AND** terminal T belongs to campaign C
- **WHEN** U calls `GET /terminals/T/load` successfully
- **THEN** U's persisted `lastCampaignId` equals `"C"` after the call

#### Scenario: Admin load updates lastCampaignId
- **GIVEN** admin A has `lastCampaignId == "C-other"`
- **AND** terminal T belongs to campaign C
- **WHEN** A calls `GET /terminals/T/load` successfully
- **THEN** A's persisted `lastCampaignId` equals `"C"` after the call

#### Scenario: Anonymous load writes nothing
- **GIVEN** terminal T is in a public-active campaign and has `meta.public == true`
- **WHEN** an anonymous caller calls `GET /terminals/T/load` successfully
- **THEN** no user document is created or modified by the call

#### Scenario: Load response payload unchanged
- **WHEN** any authorized caller calls `GET /terminals/T/load` successfully
- **THEN** the response body has the exact keys `content`, `localState`, `globalState` (no new keys are added by the lastCampaignId write)
