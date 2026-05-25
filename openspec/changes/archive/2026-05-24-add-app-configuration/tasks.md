## 1. Schema

- [x] 1.1 Add `@Prop({ type: Object, default: {} }) configuration: Record<string, unknown>` to `api/src/campaigns/schemas/campaign.schema.ts`
- [x] 1.2 Add the same `configuration` prop to `api/src/users/schemas/user.schema.ts`

## 2. Configuration service

- [x] 2.1 Create `api/src/configuration/configuration.module.ts` registering `ConfigurationService` and the Campaign + User Mongoose models (mirror `state/state.module.ts`)
- [x] 2.2 Create `api/src/configuration/configuration.service.ts` injecting the Campaign and User models
- [x] 2.3 Implement an envelope validator: body must be a plain object (reject array/scalar/null), serialized size ≤ 16 KB, nesting depth ≤ 8; throw `BadRequestException` otherwise
- [x] 2.4 Implement a deep-merge helper: plain objects merge key-by-key recursively; scalars, arrays, and null from the higher layer replace the lower wholesale
- [x] 2.5 `getCampaignConfiguration(campaignId, actor?)` → deep-merge campaign layer (lower) with the actor's user layer (higher); anonymous → campaign layer only. This backs `GET /campaigns/:id/configuration` (no separate raw or effective method)
- [x] 2.6 `setCampaignDomain(id, domain, body)` → validate envelope, then `$set: { ['configuration.' + domain]: body }`; return the updated raw campaign `configuration`
- [x] 2.7 `getUserConfiguration(userId)` → return the user's raw `configuration` (or `{}`)
- [x] 2.8 `setUserDomain(userId, domain, body)` → validate envelope, then `$set` the domain on the user; return the updated raw `configuration`
- [x] 2.9 Constrain the writable `domain` to the known set (`terminal`) so the path segment cannot write arbitrary top-level keys

## 3. Campaign configuration controller

- [x] 3.1 Create `api/src/campaigns/campaign-configuration.controller.ts` (mirror `campaign-state.controller.ts`); register it in `campaigns.module.ts` and ensure `ConfigurationModule`/service is available
- [x] 3.2 `GET /campaigns/:id/configuration` — guards `JwtOptionalGuard` + `CampaignAccessGuard`; passes `req.user` to resolve the campaign ⊕ user merge
- [x] 3.3 `PUT /campaigns/:id/configuration/terminal` — guards `JwtOptionalGuard` + `AdminGuard`; replaces the `terminal` domain

## 4. User configuration controller

- [x] 4.1 Create `api/src/users/user-configuration.controller.ts`; register it in `users.module.ts`
- [x] 4.2 `GET /users/me/configuration` — guard `JwtRequiredGuard`; resolves the user from `req.user.id`; returns raw user configuration
- [x] 4.3 `PUT /users/me/configuration/terminal` — guard `JwtRequiredGuard`; replaces the caller's `terminal` domain by `req.user.id`
- [x] 4.4 Confirm these routes never read a user id from a path parameter (identity comes only from the JWT)

## 5. Wiring & module checks

- [x] 5.1 Ensure `ConfigurationModule` is imported where its service is consumed and the controllers are declared in their owning modules
- [x] 5.2 Confirm no `configuration` field leaks into existing responses (`/terminals/:id/load`, by-hidden-id, `/campaigns`, `/campaigns/:id`, `/auth/me`)

## 6. Tests

- [x] 6.1 New campaign and new user report `configuration == {}`
- [x] 6.2 Admin PUT replaces `configuration.terminal`; sibling domains preserved; empty body resets to `{}`
- [x] 6.3 Non-admin PUT to campaign config → 403 (authenticated) / 401 (anonymous)
- [x] 6.4 Campaign config reads honor access rules (player assigned 200; anonymous on private 404)
- [x] 6.5 Authenticated user GET/PUT `/users/me/configuration` works and is isolated per user; anonymous → 401
- [x] 6.6 `GET /campaigns/:id/configuration` merge: user overrides campaign; nested `crtWave` merges key-by-key; anonymous gets campaign only; both empty → `{}`
- [x] 6.7 Envelope rejections: non-object body, >16 KB, depth >8 → 400
- [x] 6.8 Existing gameplay endpoints contain no `configuration` field

## 7. Verify

- [x] 7.1 Run `openspec validate "add-app-configuration" --strict`
- [x] 7.2 Run the API test suite and lint; confirm all green
