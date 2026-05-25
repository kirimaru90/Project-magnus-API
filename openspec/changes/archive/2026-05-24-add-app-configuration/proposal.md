## Why

The Terminal client renders its CRT aesthetic (phosphor color, sound, scanlines, the wave animation) from a single hardcoded constant. There is no way for an operator to brand a campaign with its own look, nor for a player to keep personal preferences (e.g. amber phosphor, sound off) across devices. We want server-persisted, layered configuration: a campaign-level baseline set by admins and a per-user override set by the player, with the player's choices winning.

The client constant is being repurposed as `DEFAULT_CONFIG` — the lowest fallback layer, not the live config. The active config becomes a runtime merge of three layers.

## What Changes

- Add a free-form, sparse `configuration` object to both the **campaign** and **user** records, namespaced by domain. This change implements only the `configuration.terminal` domain; the namespace is designed for future domains (e.g. `configuration.audio`).
- Resolution model — three layers, deep-merged, higher precedence wins:
  - `DEFAULT_CONFIG` (client constant, lowest) ⊕ campaign layer (server) ⊕ user layer (server, highest).
  - The server resolves **campaign ⊕ user**; the client folds that into `DEFAULT_CONFIG`.
- New dedicated endpoints (config is **not** added to any existing gameplay endpoint such as `GET /terminals/:id/load`, `GET /campaigns`, or `GET /auth/me`):
  - `GET /campaigns/:id/configuration` — server-merged campaign ⊕ user (campaign-access read).
  - `PUT /campaigns/:id/configuration/terminal` — replace the campaign's `terminal` domain (admin).
  - `GET /users/me/configuration` — the caller's raw user layer (authenticated; the first non-admin self-service surface).
  - `PUT /users/me/configuration/terminal` — replace the caller's `terminal` domain (authenticated).
- A PUT replaces **one domain** of **one layer** wholesale; sibling domains are untouched. Resetting a domain to default is `PUT … {}`.
- The server treats config values as an **opaque blob** (the client owns the schema) but enforces an **envelope**: the body must be a JSON object within size and depth limits.
- Deep-merge semantics: plain objects merge key-by-key (so a partial `crtWave` override keeps the other wave keys); scalars and arrays from the higher layer replace the lower wholesale.

## Capabilities

### New Capabilities

- `configuration`: layered terminal-app configuration stored per campaign and per user, with raw-layer reads, admin/self-service domain replacement, and a server-resolved effective merge.

### Modified Capabilities

_None._ (New routes are config-specific and grouped under the new capability; no existing requirement changes.)

## Impact

- **Schema**: `api/src/campaigns/schemas/campaign.schema.ts` and `api/src/users/schemas/user.schema.ts` — add `@Prop({ type: Object, default: {} }) configuration`.
- **Service**: new `api/src/configuration/configuration.service.ts` (+ module) — raw read, domain replace, envelope validation, deep merge for the effective resolution. Mirrors the `state` module structure.
- **Controllers**: new `api/src/campaigns/campaign-configuration.controller.ts` (mirrors `campaign-state.controller.ts`) and `api/src/users/user-configuration.controller.ts` (authenticated, non-admin).
- **Guards**: reuse `JwtOptionalGuard` + `CampaignAccessGuard` (campaign reads), `AdminGuard` (campaign writes), `JwtRequiredGuard` (user self-service). No new authz logic.
- **Spec**: new `openspec/specs/configuration/spec.md`.
- No breaking changes; both new schema fields are additive and default to `{}`. Anonymous callers have no user layer (personal prefs remain client-side); they receive `DEFAULT ⊕ campaign`.
