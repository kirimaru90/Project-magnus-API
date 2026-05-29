## MODIFIED Requirements

### Requirement: Current session inspection
The API SHALL accept `GET /auth/me` with a bearer token and return the authenticated user's profile.

The response body SHALL be `{ id, username, role, lastCampaignId, unlockedHiddenIds }` where:

- `lastCampaignId` is a string campaign id or `null`.
- `unlockedHiddenIds` is a plain object keyed by campaign id, whose values are arrays of `hiddenId` strings. An empty map is serialized as `{}`, never `null`.

If the user's persisted `lastCampaignId` is non-null but no campaign with that id currently exists, the API SHALL `$set` the user's `lastCampaignId` to `null` before responding, and SHALL return `lastCampaignId: null` in the response. This lazy self-heal compensates for any cascade gap and is observable only to the calling user.

The endpoint SHALL NOT mutate `unlockedHiddenIds` (cleanup of stale unlock entries happens on the by-hidden-id terminal route, not here).

#### Scenario: Authenticated me call
- **WHEN** `GET /auth/me` is called with a valid bearer token for user `u1`
- **THEN** the response is HTTP 200 with body `{ id, username, role, lastCampaignId, unlockedHiddenIds }` for user `u1`

#### Scenario: User with no last campaign and no unlocks
- **GIVEN** user `u1` has `lastCampaignId == null` and `unlockedHiddenIds == {}`
- **WHEN** `GET /auth/me` is called with `u1`'s token
- **THEN** the response body contains `lastCampaignId: null` and `unlockedHiddenIds: {}`

#### Scenario: User with unlocks across multiple campaigns
- **GIVEN** user `u1` has `unlockedHiddenIds == { "C1": ["vault-101"], "C2": ["root", "back-door"] }`
- **WHEN** `GET /auth/me` is called with `u1`'s token
- **THEN** the response body's `unlockedHiddenIds` equals `{ "C1": ["vault-101"], "C2": ["root", "back-door"] }`

#### Scenario: Stale lastCampaignId is lazily cleared
- **GIVEN** user `u1` has `lastCampaignId == "C-gone"` and no campaign with id `"C-gone"` exists
- **WHEN** `GET /auth/me` is called with `u1`'s token
- **THEN** the response body contains `lastCampaignId: null`
- **AND** the persisted user document's `lastCampaignId` is now `null`

#### Scenario: Valid lastCampaignId is returned as-is
- **GIVEN** user `u1` has `lastCampaignId == "C1"` and campaign `C1` exists
- **WHEN** `GET /auth/me` is called with `u1`'s token
- **THEN** the response body contains `lastCampaignId: "C1"`
- **AND** the persisted user document's `lastCampaignId` is still `"C1"`

#### Scenario: Unauthenticated me call
- **WHEN** `GET /auth/me` is called without a bearer token
- **THEN** the response is HTTP 401

#### Scenario: Expired token
- **WHEN** `GET /auth/me` is called with a token whose `exp` is in the past
- **THEN** the response is HTTP 401
