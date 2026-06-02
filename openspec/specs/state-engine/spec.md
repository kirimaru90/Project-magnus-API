# state-engine Specification

## Purpose

Embedded-document state model with mutation operations (set/increment/toggle), variable- and scope-level reset, schema-driven validation, and atomic multi-mutation requests.

## Requirements

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

### Requirement: Schema-admin operations on local state
The API SHALL expose `PATCH /terminals/:id/state/schema` for admins to add, update, or delete entries of `terminals.state` in one request.

The request body SHALL have the form `{ ops: [<op>, ...] }` where each `<op>` is one of:

- `{ "action": "add",    "name": "<varName>", "entry": { type, default, values? }, "value"?: <typed> }`
- `{ "action": "update", "name": "<currentName>", "rename"?: "<newName>", "entry": { type, default, values? }, "value"?: <typed> }`
- `{ "action": "delete", "name": "<varName>" }`

The API SHALL enforce:
- Empty `ops` SHALL be rejected with HTTP 400.
- Each variable name (as `name` or `rename`) MUST appear in at most one op per request; duplicates SHALL be rejected with HTTP 400.
- `add` on a name that already exists in `state` SHALL be rejected with HTTP 400.
- `update` or `delete` on a name that does not exist in `state` SHALL be rejected with HTTP 404.
- `rename` whose target already exists in current `state` OR is introduced/renamed-to by another op in the same request SHALL be rejected with HTTP 409.
- `entry.type` SHALL be one of `boolean`, `number`, `enum`, `string`. For `enum`, `entry.values` SHALL be a non-empty `string[]`. For non-enum types, `entry.values` SHALL be absent or ignored.
- `entry.default` SHALL match `entry.type` (and SHALL be one of `entry.values` when type is `enum`).
- When `value` is provided, it SHALL match `entry.type` (same constraints as the `set` mutation).
- When `value` is omitted on `add` or `update`, the variable's `value` SHALL be initialized / reset to `entry.default`.

Validated ops SHALL be applied in a single `updateOne` on the terminal document so that either all of them apply or none do.

The endpoint SHALL be admin-only. Non-admin callers SHALL receive HTTP 401 (anonymous) or HTTP 403 (authenticated non-admin).

A successful response SHALL be HTTP 200 with the post-update flat state snapshot: `{ state: { <key>: <value>, ... } }`.

#### Scenario: Add a new local variable
- **WHEN** an admin sends `{ ops: [{ action:"add", name:"alarm", entry:{type:"boolean", default:false} }] }` to `PATCH /terminals/T/state/schema`
- **THEN** the response is HTTP 200
- **AND** `terminals.state.alarm == { type:"boolean", value:false, default:false }`

#### Scenario: Add with explicit initial value
- **WHEN** an admin sends `{ ops: [{ action:"add", name:"score", entry:{type:"number", default:0}, value: 42 }] }`
- **THEN** `terminals.state.score == { type:"number", value:42, default:0 }`

#### Scenario: Update resets value to default when value omitted
- **WHEN** an admin sends `{ ops: [{ action:"update", name:"score", entry:{type:"number", default:0} }] }` and `score.value` was previously `99`
- **THEN** the response is HTTP 200 and `state.score.value == 0`

#### Scenario: Update with rename
- **WHEN** an admin sends `{ ops: [{ action:"update", name:"mode", rename:"phase", entry:{type:"enum", values:["idle","active"], default:"idle"} }] }`
- **THEN** `state.mode` is removed and `state.phase == { type:"enum", values:["idle","active"], value:"idle", default:"idle" }`

#### Scenario: Delete a local variable
- **WHEN** an admin sends `{ ops: [{ action:"delete", name:"legacy" }] }` and `legacy` exists in state
- **THEN** the response is HTTP 200 and `legacy` is absent from `state`

#### Scenario: Mixed ops in one request
- **WHEN** an admin sends a body containing one `add`, one `update`, and one `delete` for three distinct variables
- **THEN** all three are applied atomically in a single document update

#### Scenario: Duplicate variable in ops rejected
- **WHEN** an admin sends two ops referring to the same variable name (via `name` or `rename`) in one request
- **THEN** the response is HTTP 400

#### Scenario: Rename target collides with existing variable
- **WHEN** an admin sends `{ ops: [{ action:"update", name:"foo", rename:"bar", entry:{...} }] }` and `bar` already exists in state
- **THEN** the response is HTTP 409

#### Scenario: Update on missing variable
- **WHEN** an admin targets a name that does not exist in state via `update`
- **THEN** the response is HTTP 404

#### Scenario: Delete on missing variable
- **WHEN** an admin targets a name that does not exist in state via `delete`
- **THEN** the response is HTTP 404

#### Scenario: Empty ops rejected
- **WHEN** an admin sends `{ ops: [] }`
- **THEN** the response is HTTP 400

#### Scenario: Invalid entry default for type
- **WHEN** an admin sends an op whose `entry.default` does not match `entry.type` (e.g., `{type:"number", default:"five"}`)
- **THEN** the response is HTTP 400

#### Scenario: Invalid value for entry type
- **WHEN** an admin sends an op whose explicit `value` does not match `entry.type`
- **THEN** the response is HTTP 400

#### Scenario: Non-admin caller rejected
- **WHEN** a player or anonymous caller posts to `PATCH /terminals/T/state/schema`
- **THEN** the response is HTTP 403 (player) or HTTP 401 (anonymous)

### Requirement: Schema-admin operations on global state
The API SHALL expose `PATCH /campaigns/:id/state/schema` for admins to add, update, or delete entries of `campaigns.state` in one request.

The body shape and per-op rules SHALL be identical to `PATCH /terminals/:id/state/schema` (see "Schema-admin operations on local state").

In addition, because terminals in the same campaign MAY reference global variables at `content.state.global.<varKey>`, the API SHALL apply cross-reference protection:

- **Delete with references**: A `delete` op whose `name` is referenced (key exists at `content.state.global.<name>`) by at least one terminal in the campaign SHALL be rejected with HTTP 409. The error body SHALL include `{ error: "Cannot delete referenced variables", conflicts: [ { variable: "<name>", referencedBy: [ { id: "<terminalId>", title: "<terminalTitle>" }, ... ] }, ... ] }`.
- **Rename with reference collision**: A rename whose `from` is referenced by a terminal that **also** already has the `to` key present at `content.state.global.<to>` SHALL be rejected with HTTP 409 with a similar `conflicts` payload identifying the offending terminals.

When all rename ops pass the collision check, the API SHALL rewrite references in all affected terminals via Mongo `$rename` on `content.state.global.<from>` → `content.state.global.<to>` BEFORE applying the campaign-level `$set`. On partial failure of the multi-document write, the campaign `$set` SHALL NOT be applied; the request SHALL surface the error and admins MAY retry the same request to converge (the request is idempotent under retry).

A successful response SHALL be HTTP 200 with the post-update flat state snapshot: `{ state: { <key>: <value>, ... } }`.

#### Scenario: Add a new global variable
- **WHEN** an admin sends `{ ops: [{ action:"add", name:"siteOpen", entry:{type:"boolean", default:false} }] }` to `PATCH /campaigns/C/state/schema`
- **THEN** the response is HTTP 200 and `campaigns.state.siteOpen.value == false`

#### Scenario: Delete an unreferenced global variable
- **WHEN** an admin deletes a global `name` that no terminal in C references at `content.state.global.<name>`
- **THEN** the response is HTTP 200 and the variable is absent from `campaigns.state`

#### Scenario: Delete a referenced global variable rejected
- **WHEN** an admin deletes a global `name` that at least one terminal in C references at `content.state.global.<name>`
- **THEN** the response is HTTP 409
- **AND** the body contains `conflicts: [{ variable: "<name>", referencedBy: [ { id, title }, ... ] }]`
- **AND** the campaign state is unchanged

#### Scenario: Rename a referenced global variable rewrites terminals
- **WHEN** an admin renames a global `mode` → `phase` and three terminals in C reference `content.state.global.mode`
- **THEN** the response is HTTP 200
- **AND** each of those three terminals now has `content.state.global.phase` instead of `content.state.global.mode`
- **AND** `campaigns.state.phase` exists with the updated entry; `campaigns.state.mode` is absent

#### Scenario: Rename rejected when target already exists on a referencing terminal
- **WHEN** an admin renames `mode` → `phase` and at least one terminal in C already has both `content.state.global.mode` AND `content.state.global.phase` populated
- **THEN** the response is HTTP 409
- **AND** the body identifies the offending terminals
- **AND** no rewrites are performed

#### Scenario: Apply order on rename — terminals first, campaign last
- **WHEN** an admin renames a referenced global variable
- **THEN** the API performs the `$rename` updates on the affected terminals BEFORE the campaign-level `$set` that finalizes the new schema

#### Scenario: Empty ops on campaign schema rejected
- **WHEN** an admin sends `{ ops: [] }` to `PATCH /campaigns/C/state/schema`
- **THEN** the response is HTTP 400

#### Scenario: Non-admin caller rejected on campaign schema
- **WHEN** a player or anonymous caller posts to `PATCH /campaigns/C/state/schema`
- **THEN** the response is HTTP 403 (player) or HTTP 401 (anonymous)

### Requirement: Schema-admin endpoints leave runtime endpoints unchanged
The introduction of `PATCH /terminals/:id/state/schema` and `PATCH /campaigns/:id/state/schema` SHALL NOT alter the request shape, response shape, authorization rules, or semantics of:
- `GET /terminals/:id/state` and `GET /campaigns/:id/state`
- `POST /terminals/:id/state/mutate` and `POST /campaigns/:id/state/mutate`
- `POST /terminals/:id/state/reset`, `POST /terminals/:id/state/:key/reset`
- `POST /campaigns/:id/state/reset`, `POST /campaigns/:id/state/:key/reset`

#### Scenario: Existing mutate endpoint unaffected
- **WHEN** the schema-admin endpoints are deployed
- **AND** a caller posts a valid `mutate` request to an unchanged variable
- **THEN** the response shape and behavior is identical to the pre-deployment contract

#### Scenario: Existing reset endpoint unaffected
- **WHEN** the schema-admin endpoints are deployed
- **AND** an admin posts to `POST /campaigns/:id/state/reset`
- **THEN** every variable in the campaign and its terminals is reset to its `default`, identical to the pre-deployment contract
