## Context

The Terminal renders from a single client constant (`APP_CONFIG`, being renamed to `DEFAULT_CONFIG`). The API has no notion of presentation configuration. Two record types are natural homes for persisted layers: `Campaign` (operator-set baseline) and `User` (player preference). Both are Mongo documents managed by `CampaignsService` / `UsersService`.

The codebase already has the patterns this feature needs:
- **Opaque JSON storage**: `Terminal.content` is `@Prop({ type: Object })`, a free-form blob the server does not schema-validate. Configuration follows the same precedent.
- **Scoped sub-controllers**: `campaign-state.controller.ts` sits alongside `campaigns.controller.ts` and delegates to a shared `StateService`. Configuration mirrors this with a `campaign-configuration.controller.ts` + `ConfigurationService`.
- **Guard composition**: `JwtOptionalGuard` + `CampaignAccessGuard` for access-gated reads, `AdminGuard` for admin writes, `JwtRequiredGuard` for authenticated-only routes.

The one genuinely new thing is a **non-admin self-service write**: today the entire `users` controller is `AdminGuard`-gated. Users editing their own configuration is the first route where an authenticated player writes their own record.

## Goals / Non-Goals

**Goals:**
- Persist sparse, per-domain configuration overrides on campaigns and users.
- Resolve an effective config server-side as campaign ⊕ user (user wins), deep-merged.
- Let admins write the campaign layer and let any authenticated user write their own layer.
- Keep the value schema entirely client-owned; the server validates only the envelope.

**Non-Goals:**
- No server-side knowledge of config keys/types (no validating `phosphorColor ∈ {green,amber,white}` etc.). The client reads defensively over `DEFAULT_CONFIG`.
- No anonymous user layer — anonymous personal prefs live in client `localStorage` and are out of scope here.
- No embedding of configuration into existing gameplay endpoints (`/terminals/:id/load`, by-hidden-id, `/campaigns`, `/campaigns/:id`, `/auth/me`). Delivery is via dedicated routes only.
- No domains other than `terminal` in this change (the namespace supports more later).
- No per-terminal configuration layer — configuration is campaign- and user-scoped only.

## Decisions

### Store `configuration` as an opaque object on Campaign and User
Add `@Prop({ type: Object, default: {} }) configuration: Record<string, unknown>` to both schemas. Sparse and namespaced: a campaign that only sets phosphor stores `{ terminal: { phosphorColor: 'amber' } }`. Sparseness is what keeps `DEFAULT_CONFIG` authoritative — new client default keys are inherited automatically because absent keys fall through.

**Alternative considered:** a strongly-typed schema mirroring `DEFAULT_CONFIG`. Rejected — it couples the server to the client's presentation schema, forcing a server change for every new client config key. The client owns the schema; the server is a store.

### PUT replaces one domain of one layer
`PUT …/configuration/terminal` sets `configuration.terminal` wholesale via `$set: { 'configuration.terminal': body }`, leaving sibling domains intact. This matches the chosen "full replace per layer" model while protecting future domains. Reset-to-default is simply `PUT … {}` (an empty domain contributes nothing to the merge). No separate reset endpoint is needed.

**Alternative considered:** PATCH/deep-merge into the stored layer plus a key-level reset endpoint. Rejected for now — more surface area; full replace is the simplest correct model and the client already holds the full domain object it wants to persist.

### Server resolves campaign ⊕ user; client folds in DEFAULT_CONFIG
The effective endpoint deep-merges the campaign layer (lower) with the user layer (higher). The client then computes `DEFAULT_CONFIG ⊕ effective`. The client never reasons about campaign-vs-user precedence — the server owns it.

Deep-merge rule: for two plain objects, merge key-by-key recursively; for any other value (scalar, array, null), the higher-precedence layer replaces the lower wholesale. This makes partial nested overrides work (`crtWave: { speed: 0.9 }` keeps the other wave keys) while keeping arrays atomic. `DEFAULT_CONFIG` has no arrays today; the rule is fixed now so adding one later is unambiguous.

### A single campaign read returns the effective merge
`GET /campaigns/:id/configuration` returns the computed campaign ⊕ user merge — what the Terminal renders. There is no separate `/effective` route and no separate raw-campaign-layer read; the bare path is the one campaign read.

Consequence: the campaign layer is observable in isolation only through a caller whose user layer is empty — an anonymous caller or an admin with no personal `terminal` overrides — for whom `effective == campaign`. This is acceptable: anonymous and clean-admin reads cover authoring/verification, and the backoffice admin editing the campaign baseline normally has no user-level terminal prefs of their own. If a dedicated raw-campaign read is needed later (e.g. to edit the campaign layer while the admin also has personal prefs), it can be added without changing this endpoint.

The user layer needs no effective endpoint: `GET /users/me/configuration` already returns exactly the user override the client folds into `DEFAULT_CONFIG` for the pre-campaign (selection-screen) chrome.

### Self-service user routes under /users/me, gated JwtRequired
`GET /users/me/configuration` and `PUT /users/me/configuration/terminal` resolve the caller from the JWT (`req.user.id`), never from a path id, so a user can only read/write their own configuration. These are the first non-admin routes in the users area; they use `JwtRequiredGuard`, not `AdminGuard`.

### Envelope validation only
On every PUT, validate structure, not values: the body MUST be a plain JSON object (reject arrays, scalars, null), within a serialized-size cap and a maximum nesting depth. This prevents abuse (megabyte blobs, deeply nested payloads) without coupling the server to the config schema. Limits: **16 KB** serialized, **max depth 8**. Violations return HTTP 400.

## Risks / Trade-offs

- **[Client can store malformed/garbage config]** → Accepted by the opaque-blob choice. Worst case is a cosmetic glitch; the client merges over `DEFAULT_CONFIG` and reads keys defensively, so missing/extra/odd keys degrade gracefully. Gameplay state is unaffected (separate system).
- **[First non-admin write surface widens the attack area on user records]** → Mitigated by resolving identity strictly from the JWT (`/users/me`, never `/users/:id`) and by envelope limits. No path-id user write is introduced.
- **[Envelope limits too tight for a future domain]** → 16 KB / depth 8 is generous for presentation config; limits are constants that can be raised without contract change.
- **[Effective merge cost on hot path]** → The merge is two small in-memory objects per request; negligible. Reads stay access-gated by existing guards, so no new query patterns.
- **[Anonymous players lose prefs on device change]** → By design; persisting anonymous prefs would require a server-side anonymous identity, which is out of scope.
- **[No raw-campaign-layer read]** → The single campaign endpoint returns the merge, so an admin who also has personal `terminal` prefs cannot see the campaign baseline in isolation via the API. Mitigated for now because campaign editing is normally done by clean admins; a raw read can be added later if needed.
