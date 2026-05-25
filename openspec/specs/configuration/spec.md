## ADDED Requirements

### Requirement: Layered configuration storage
The API SHALL persist a free-form `configuration` object on both campaign and user records. The object SHALL be sparse and namespaced by domain (this capability defines only the `terminal` domain). The server SHALL treat configuration values as opaque — it SHALL NOT validate, coerce, or interpret the keys or value types within a domain. Both fields SHALL default to an empty object and SHALL be additive (existing records read as `{}`).

#### Scenario: New campaign has empty configuration
- **WHEN** an admin creates a campaign
- **THEN** the campaign's `configuration` is `{}`

#### Scenario: New user has empty configuration
- **WHEN** an admin creates a user
- **THEN** the user's `configuration` is `{}`

#### Scenario: Opaque values are stored verbatim
- **GIVEN** an admin with no user-layer overrides sets a campaign's `terminal` domain to `{ "phosphorColor": "amber", "soundVolume": 0.5, "crtWave": { "speed": 0.9 } }`
- **WHEN** that admin reads `GET /campaigns/:id/configuration`
- **THEN** `terminal` equals the submitted object exactly, with no added, removed, or coerced keys

### Requirement: Campaign configuration access and resolution
The API SHALL expose `GET /campaigns/:id/configuration` returning the configuration produced by deep-merging the campaign layer (lower precedence) with the authenticated caller's user layer (higher precedence), and `PUT /campaigns/:id/configuration/terminal` replacing the campaign's `configuration.terminal` domain wholesale with the request body. There SHALL NOT be a separate raw-campaign-layer read or an `effective` route. For an anonymous caller, the GET result SHALL be the campaign layer alone (no user layer). The GET SHALL apply the same access rules as `GET /campaigns/:id` (admin always; player only for assigned or public-active; anonymous only for public-active; otherwise 404). The PUT SHALL require an admin and SHALL leave sibling domains of `configuration` untouched.

The deep-merge rule SHALL be: for two plain objects, merge key-by-key recursively; for any other value (scalar, array, or null), the higher-precedence layer's value replaces the lower's wholesale.

#### Scenario: User layer overrides campaign layer
- **GIVEN** campaign C has `configuration.terminal` of `{ "phosphorColor": "amber", "soundEnabled": true }`
- **AND** the calling player has `configuration.terminal` of `{ "soundEnabled": false }`
- **WHEN** the player calls `GET /campaigns/C/configuration`
- **THEN** the response `terminal` equals `{ "phosphorColor": "amber", "soundEnabled": false }`

#### Scenario: Nested objects merge key-by-key
- **GIVEN** campaign C has `configuration.terminal.crtWave` of `{ "speed": 0.6, "count": 7, "vignetteStrength": 1.0 }`
- **AND** the calling player has `configuration.terminal.crtWave` of `{ "speed": 0.9 }`
- **WHEN** the player calls `GET /campaigns/C/configuration`
- **THEN** the response `terminal.crtWave` equals `{ "speed": 0.9, "count": 7, "vignetteStrength": 1.0 }`

#### Scenario: Anonymous receives only the campaign layer
- **GIVEN** campaign C (active, public) has `configuration.terminal` of `{ "phosphorColor": "amber" }`
- **WHEN** an anonymous caller calls `GET /campaigns/C/configuration`
- **THEN** the response `terminal` equals `{ "phosphorColor": "amber" }`

#### Scenario: Empty layers resolve to an empty object
- **GIVEN** campaign C and the calling player both have empty `configuration`
- **WHEN** the player calls `GET /campaigns/C/configuration`
- **THEN** the response is HTTP 200 with `{}`

#### Scenario: Anonymous cannot read configuration of a private campaign
- **WHEN** an anonymous caller calls `GET /campaigns/C/configuration` for a private campaign C
- **THEN** the response is HTTP 404

#### Scenario: Admin replaces the campaign terminal domain
- **WHEN** an admin sends `PUT /campaigns/C/configuration/terminal` with `{ "phosphorColor": "amber" }`
- **THEN** the response is HTTP 200
- **AND** the campaign's `configuration.terminal` equals `{ "phosphorColor": "amber" }`

#### Scenario: Replacing one domain preserves sibling domains
- **GIVEN** campaign C has `configuration` of `{ "terminal": { "soundEnabled": false }, "audio": { "bus": 2 } }`
- **WHEN** an admin sends `PUT /campaigns/C/configuration/terminal` with `{ "phosphorColor": "green" }`
- **THEN** `configuration.terminal` equals `{ "phosphorColor": "green" }`
- **AND** `configuration.audio` still equals `{ "bus": 2 }`

#### Scenario: Empty body resets the domain to default
- **GIVEN** campaign C has `configuration.terminal` of `{ "phosphorColor": "amber" }`
- **WHEN** an admin sends `PUT /campaigns/C/configuration/terminal` with `{}`
- **THEN** `configuration.terminal` equals `{}`

#### Scenario: Non-admin cannot write campaign configuration
- **WHEN** a player or anonymous caller sends `PUT /campaigns/C/configuration/terminal`
- **THEN** the response is HTTP 403 (authenticated non-admin) or 401 (anonymous)

### Requirement: User self-service configuration management
The API SHALL expose `GET /users/me/configuration` returning the authenticated caller's raw `configuration` object, and `PUT /users/me/configuration/terminal` replacing the caller's `configuration.terminal` domain wholesale. Both routes SHALL require authentication and SHALL resolve the target user from the JWT identity, never from a path parameter. A user SHALL only ever read or write their own configuration. The PUT SHALL leave sibling domains untouched.

#### Scenario: Authenticated user reads own configuration
- **GIVEN** a logged-in player whose `configuration.terminal` is `{ "soundEnabled": false }`
- **WHEN** they call `GET /users/me/configuration`
- **THEN** the response is HTTP 200 with `{ "terminal": { "soundEnabled": false } }`

#### Scenario: Authenticated user replaces own terminal domain
- **WHEN** a logged-in player sends `PUT /users/me/configuration/terminal` with `{ "phosphorColor": "white" }`
- **THEN** the response is HTTP 200
- **AND** their `configuration.terminal` equals `{ "phosphorColor": "white" }`

#### Scenario: Anonymous cannot use the self-service routes
- **WHEN** an anonymous caller calls `GET /users/me/configuration` or `PUT /users/me/configuration/terminal`
- **THEN** the response is HTTP 401

#### Scenario: A user cannot affect another user's configuration
- **GIVEN** two distinct logged-in users A and B
- **WHEN** user A sends `PUT /users/me/configuration/terminal`
- **THEN** only user A's configuration changes
- **AND** user B's configuration is unchanged

### Requirement: Configuration envelope validation
The API SHALL validate the structural envelope of every configuration PUT body without inspecting domain-specific keys or value types. A PUT body SHALL be a plain JSON object; arrays, scalars, and `null` SHALL be rejected with HTTP 400. The serialized body SHALL NOT exceed 16 KB and the object nesting SHALL NOT exceed a depth of 8; violations SHALL be rejected with HTTP 400.

#### Scenario: Non-object body is rejected
- **WHEN** a writer sends a configuration PUT whose body is an array, a string, a number, or `null`
- **THEN** the response is HTTP 400

#### Scenario: Oversized body is rejected
- **WHEN** a writer sends a configuration PUT whose serialized body exceeds 16 KB
- **THEN** the response is HTTP 400

#### Scenario: Excessively nested body is rejected
- **WHEN** a writer sends a configuration PUT whose object nesting exceeds depth 8
- **THEN** the response is HTTP 400

#### Scenario: Configuration is not exposed on existing gameplay endpoints
- **WHEN** any caller loads `GET /terminals/:id/load`, `GET /campaigns/:id/terminals/by-hidden-id/:hiddenId`, `GET /campaigns`, `GET /campaigns/:id`, or `GET /auth/me`
- **THEN** the response body contains no `configuration` field
