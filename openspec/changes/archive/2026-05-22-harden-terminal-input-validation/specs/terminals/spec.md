## ADDED Requirements

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

## MODIFIED Requirements

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
