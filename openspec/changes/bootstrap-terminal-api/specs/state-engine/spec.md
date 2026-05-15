## ADDED Requirements

### Requirement: Embedded state model
The API SHALL store state as an embedded map on the owning document:
- Local state lives at `terminals.state` keyed by variable name, each entry `{ type, value, default }`.
- Global state lives at `campaigns.state` keyed by variable name, each entry `{ type, value, default }`.

The `type` SHALL be one of `boolean`, `number`, `enum`, or `string`. Enum entries SHALL additionally carry `values: string[]`.

#### Scenario: Persisted state shape
- **WHEN** a terminal with `state.local.foo: {type:"boolean", default:false}` is created
- **THEN** the persisted document has `state.foo == { type: "boolean", value: false, default: false }`

#### Scenario: Enum state shape
- **WHEN** a terminal declares `state.local.mood: {type:"enum", values:["calm","panicked"], default:"calm"}`
- **THEN** the persisted document has `state.mood == { type:"enum", values:["calm","panicked"], value:"calm", default:"calm" }`

### Requirement: Reading state
The API SHALL expose:
- `GET /terminals/:id/state` — returns the terminal's local state as a flat `{ key: value }` map.
- `GET /campaigns/:id/state` — returns the campaign's global state as a flat `{ key: value }` map.

Both routes SHALL apply campaign-access rules (admin/player/public).

#### Scenario: Read local state
- **WHEN** a caller with access to terminal T calls `GET /terminals/T/state`
- **THEN** the response is HTTP 200 with `{ <key>: <value>, ... }`

#### Scenario: Read global state
- **WHEN** a caller with access to campaign C calls `GET /campaigns/C/state`
- **THEN** the response is HTTP 200 with `{ <key>: <value>, ... }`

### Requirement: Mutation operations
The API SHALL expose `POST /terminals/:id/state/mutate` and `POST /campaigns/:id/state/mutate`. Each accepts a body of the form `{ mutations: [ { key, op, value?, by? }, ... ] }` where:
- `key` is `local.<name>` for terminal-state routes or `global.<name>` for campaign-state routes. Cross-scope mutations in a single request SHALL be rejected.
- `op` is one of `set`, `increment`, `toggle`.
- `value` is supplied for `set`; `by` (number) is supplied for `increment`; neither is supplied for `toggle`.

The API SHALL validate that:
- Every referenced variable exists in the target document's state map. Otherwise 400.
- `increment` is applied only to `type: number` variables. Otherwise 400.
- `toggle` is applied only to `type: boolean` variables. Otherwise 400.
- `set` value type matches the variable's declared `type` (with enum values restricted to the declared list). Otherwise 400.

Validated mutations SHALL be applied in a **single** `updateOne` against the document so that either all of them apply or none do.

The endpoint SHALL be callable per the campaign access rules: admin always; player on assigned/public-active campaigns; anonymous on public-active campaigns.

#### Scenario: Atomic multi-mutation set + increment
- **WHEN** a caller posts `{ mutations: [{key:"local.foo", op:"set", value:true}, {key:"local.count", op:"increment", by:1}] }` to `POST /terminals/T/state/mutate`
- **THEN** the response is HTTP 200 with the updated state snapshot
- **AND** the terminal's `state.foo.value == true` and `state.count.value` is incremented by 1

#### Scenario: Toggle a boolean
- **WHEN** a caller posts `{ mutations: [{key:"local.foo", op:"toggle"}] }` where `foo` is currently `false`
- **THEN** `state.foo.value` is now `true`

#### Scenario: Type mismatch on set
- **WHEN** a caller posts `{ mutations: [{key:"local.count", op:"set", value:"three"}] }` where `count` is `type:"number"`
- **THEN** the response is HTTP 400 and `state.count.value` is unchanged

#### Scenario: Invalid enum value
- **WHEN** a caller posts `set` for an enum variable with a value not in the declared `values`
- **THEN** the response is HTTP 400

#### Scenario: Undeclared variable
- **WHEN** a caller posts a mutation against a `key` that does not exist in the target document's state
- **THEN** the response is HTTP 400 and nothing is persisted

#### Scenario: Cross-scope batch rejected
- **WHEN** a caller posts mutations that mix `local.foo` and `global.bar` in a single request
- **THEN** the response is HTTP 400

#### Scenario: Anonymous mutation on public campaign
- **WHEN** an anonymous caller posts a valid mutation to a terminal in an active+public campaign
- **THEN** the response is HTTP 200 and the mutation is applied

#### Scenario: Anonymous mutation on private campaign
- **WHEN** an anonymous caller posts to a terminal whose campaign is not public
- **THEN** the response is HTTP 404

### Requirement: Reset operations
The API SHALL expose:
- `POST /terminals/:id/state/reset` (admin) — resets every variable in `terminals.state` to its `default`.
- `POST /terminals/:id/state/:key/reset` (admin) — resets one variable.
- `POST /campaigns/:id/state/reset` (admin) — resets every variable in `campaigns.state` and additionally every `terminals.state` for terminals in that campaign.
- `POST /campaigns/:id/state/:key/reset` (admin) — resets one global variable.

Reset SHALL always restore from each entry's `default` field. The `default` field SHALL NOT be modified by mutation operations and SHALL be re-mirrored from the terminal content on import/update per the additive semantics defined in the `terminals` capability.

#### Scenario: Reset a single local variable
- **WHEN** an admin posts to `POST /terminals/T/state/access_count/reset` where `access_count.default == 0` and the current value is `7`
- **THEN** the response is HTTP 200 and `state.access_count.value == 0`

#### Scenario: Reset all local state of a terminal
- **WHEN** an admin posts to `POST /terminals/T/state/reset`
- **THEN** every key in `terminals.state` has its `value` restored to its `default`

#### Scenario: Reset entire campaign
- **WHEN** an admin posts to `POST /campaigns/C/state/reset`
- **THEN** every key in `campaigns.state` is reset to its default
- **AND** every `terminals.state` for terminals in C is reset to defaults

#### Scenario: Non-admin reset rejected
- **WHEN** a player or anonymous caller posts to any reset endpoint
- **THEN** the response is HTTP 403 (player) or 401 (anonymous)

### Requirement: Mutation responses include the post-mutation snapshot
Every successful mutation or reset response SHALL include the new state snapshot for the affected scope, so the client does not need a follow-up `GET`.

#### Scenario: Snapshot in mutation response
- **WHEN** a caller successfully posts to `/state/mutate`
- **THEN** the response body includes `{ state: { <key>: <value>, ... } }` reflecting the post-mutation values
