## MODIFIED Requirements

### Requirement: Mutation operations
The API SHALL expose `POST /terminals/:id/state/mutate` and `POST /campaigns/:id/state/mutate`. Each accepts a body of the form `{ mutations: [ { key, op, value?, by? }, ... ] }` where:
- `key` is `local.<name>` for terminal-state routes or `global.<name>` for campaign-state routes. Cross-scope mutations in a single request SHALL be rejected.
- `op` is one of `set`, `increment`, `toggle`.
- `value` is supplied for `set`; `by` (number) is optional for `increment` and SHALL default to `1` when omitted; neither is supplied for `toggle`.

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

#### Scenario: Increment without by defaults to 1
- **WHEN** a caller posts `{ mutations: [{key:"local.count", op:"increment"}] }` (no `by`) where `count.value == 5`
- **THEN** the response is HTTP 200 and `state.count.value == 6`

#### Scenario: Global increment without by defaults to 1
- **WHEN** a caller posts `{ mutations: [{key:"global.tick", op:"increment"}] }` (no `by`) to `POST /campaigns/C/state/mutate` where `tick.value == 0`
- **THEN** the response is HTTP 200 and `state.tick.value == 1`

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
