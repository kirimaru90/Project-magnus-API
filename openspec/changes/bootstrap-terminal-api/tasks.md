## 1. Project Scaffold

- [ ] 1.1 Initialize a new NestJS project at the repo root (or `api/` subdir if preferred), TypeScript strict mode on
- [ ] 1.2 Replace the default Express HTTP adapter with `FastifyAdapter` in `main.ts`
- [ ] 1.3 Add runtime deps: `@nestjs/mongoose`, `mongoose`, `@nestjs/jwt`, `@nestjs/passport`, `passport`, `passport-jwt`, `bcrypt`, `class-validator`, `class-transformer`, `@nestjs/swagger`, `@fastify/helmet`
- [ ] 1.4 Add a `ConfigModule` reading `JWT_SECRET`, `MONGO_URL`, `PORT`, `CORS_ALLOWED_ORIGINS`, `BOOTSTRAP_ADMIN_USERNAME`, `BOOTSTRAP_ADMIN_PASSWORD`
- [ ] 1.5 Wire `MongooseModule.forRootAsync` against `MONGO_URL`
- [ ] 1.6 Enable global `ValidationPipe` with `whitelist: true`, `forbidNonWhitelisted: true`, `transform: true`
- [ ] 1.7 Mount Swagger UI at `/docs` with `@nestjs/swagger` document builder
- [ ] 1.8 Configure CORS from `CORS_ALLOWED_ORIGINS` (comma-separated env var)

## 2. Mongoose Schemas

- [ ] 2.1 `User` schema: `{ username (unique index), passwordHash, role, createdAt }`
- [ ] 2.2 `Campaign` schema: `{ name, isActive, isPublic, players: [ObjectId], state: Map<string, StateEntry>, createdAt, updatedAt }`
- [ ] 2.3 `Terminal` schema: `{ campaignId (indexed), title, content: Mixed, state: Map<string, StateEntry>, createdAt, updatedAt }`
- [ ] 2.4 `FictionalUser` schema: `{ terminalId, username, password }` with compound unique index on `(terminalId, username)`
- [ ] 2.5 Define a shared `StateEntry` sub-schema: `{ type: 'boolean' | 'number' | 'enum' | 'string', value: Mixed, default: Mixed, values?: [string] }`
- [ ] 2.6 Add indexes for the anonymous campaign listing: `campaigns.{isActive, isPublic}`

## 3. AuthModule

- [ ] 3.1 `AuthService.login(username, password)` — fetch user, bcrypt-compare, sign JWT (24h) on success
- [ ] 3.2 `JwtStrategy` (passport-jwt) verifying against `JWT_SECRET`, attaching `{ id, role }` to `req.user`
- [ ] 3.3 `JwtRequiredGuard` and `JwtOptionalGuard`
- [ ] 3.4 `AdminGuard` checking `req.user.role === 'admin'`
- [ ] 3.5 `AuthController`: `POST /auth/login`, `POST /auth/logout` (204), `GET /auth/me`
- [ ] 3.6 Generic 401 error message for all login failure paths (unknown user, wrong password, expired token)
- [ ] 3.7 Bootstrap script `scripts/bootstrap-admin.ts` reading `BOOTSTRAP_ADMIN_USERNAME`/`PASSWORD`, idempotent (no-op if a user with that username exists)

## 4. UsersModule

- [ ] 4.1 `UsersService` with `list`, `findById`, `create`, `update`, `delete`
- [ ] 4.2 Bcrypt hashing (cost 12) in `create` and in `update` when `password` is supplied
- [ ] 4.3 DTOs with `class-validator`: `CreateUserDto`, `UpdateUserDto` — enforce `role in {admin, player}`, username regex, password min length
- [ ] 4.4 `UsersController`: full CRUD under `/users`, admin-only via `AdminGuard`
- [ ] 4.5 Reject self-delete with HTTP 409 in `delete`
- [ ] 4.6 Response shaping: never include `passwordHash` (use a `toUserResponse` mapper)
- [ ] 4.7 On user delete, pull the id from every `campaigns.players` array

## 5. CampaignsModule

- [ ] 5.1 `CampaignsService` with actor-aware `list(actor)` returning the correct subset (admin/player/anonymous)
- [ ] 5.2 `findById(actor, id)` that returns 404 when the campaign exists but the actor cannot see it
- [ ] 5.3 `create`, `update`, `delete`, `toggleActive`
- [ ] 5.4 `addPlayer`, `removePlayer`, `listPlayers` — admin-only; reject if target user has role `admin`
- [ ] 5.5 `CampaignAccessGuard` that takes the `:id` param and applies the actor rules
- [ ] 5.6 `CampaignsController` exposing all `/campaigns` and `/campaigns/:id/players` routes
- [ ] 5.7 Cascade on delete: drop the campaign, every terminal in it, every fictional user of those terminals
- [ ] 5.8 Anonymous projection of `GET /campaigns/:id`: empty `players` array regardless of actual content

## 6. TerminalsModule

- [ ] 6.1 Define the terminal content schema as a class-validator nested DTO (`TerminalContentDto`) covering `meta`, `state`, `login?`, `nodes`
- [ ] 6.2 Implement the condition validator (recursive: leaf `{key,eq|neq|gt|lt|gte|lte|in,value}` or combinator `{and:[...]}`/`{or:[...]}` or `{default:true}`)
- [ ] 6.3 `TerminalsService.create(campaignId, contentDto)`: validate → extract `login.users` to `FictionalUser` rows → strip them from `content` → project `state.local` into `terminal.state` → project `state.global` into `campaign.state` first-declaration-wins
- [ ] 6.4 `TerminalsService.update(id, contentDto)`: same flow, but state projection uses additive semantics (existing keys keep value, new keys get defaults, removed keys are orphaned)
- [ ] 6.5 `TerminalsService.delete(id)`: remove terminal + its fictional users (campaign global state untouched)
- [ ] 6.6 `TerminalsService.load(id)` returning `{ content, localState, globalState }` where the state objects are flat key→value maps and `content.login` is fully stripped
- [ ] 6.7 `TerminalsService.detail(id, actor)` returning `{ ..., fictionalUsers }` only when `actor.role === 'admin'`
- [ ] 6.8 `TerminalsService.export(id)` reconstituting `content.login.users` from `FictionalUser` rows
- [ ] 6.9 `TerminalsService.import(campaignId, payload)` — alias of `create` with explicit import semantics; always creates new, never overwrites
- [ ] 6.10 `TerminalsService.fictionalLogin(id, username, password)` — plaintext compare against `FictionalUser` rows
- [ ] 6.11 `TerminalAccessGuard` resolving terminal → campaign and delegating to `CampaignAccessGuard`'s rule
- [ ] 6.12 `TerminalsController` exposing every route in the architecture's "Terminals" and "Terminal Playback" sections

## 7. StateModule

- [ ] 7.1 Shared `StateService` with `validateMutations(declarations, mutations, scope)` returning a typed plan or throwing `BadRequestException`
- [ ] 7.2 `applyMutationsAtomic(documentRef, mutationPlan)` building a single `$set`/`$inc` and issuing one `updateOne`
- [ ] 7.3 `resetAll(documentRef)` and `resetKey(documentRef, key)` that copy `default` → `value` for the appropriate keys
- [ ] 7.4 Terminal-state controller routes: `GET /terminals/:id/state`, `POST /terminals/:id/state/mutate`, `POST /terminals/:id/state/reset` (admin), `POST /terminals/:id/state/:key/reset` (admin)
- [ ] 7.5 Campaign-state controller routes: `GET /campaigns/:id/state`, `POST /campaigns/:id/state/mutate`, `POST /campaigns/:id/state/reset` (admin), `POST /campaigns/:id/state/:key/reset` (admin)
- [ ] 7.6 Reject mutation requests that mix `local.*` and `global.*` in a single batch (400)
- [ ] 7.7 Reject mutations referencing undeclared keys (400)
- [ ] 7.8 Type-check rules: `set` value type matches declared `type` (enum value ∈ declared `values`); `increment` requires `type:number`; `toggle` requires `type:boolean`
- [ ] 7.9 Campaign-wide reset: also reset every terminal's local state for terminals in that campaign
- [ ] 7.10 Mutation/reset responses include the post-mutation state snapshot

## 8. Cross-cutting

- [ ] 8.1 Global exception filter mapping mongoose CastError → 400 and DuplicateKeyError → 409
- [ ] 8.2 Request logging middleware (method, path, status, duration, actor id)
- [ ] 8.3 Health endpoint `GET /health` returning `{ status: 'ok', mongo: <ping result> }`
- [ ] 8.4 Helmet headers configured for the Fastify adapter
- [ ] 8.5 `.env.example` documenting every env var; README section on bootstrapping the first admin

## 9. Tests

- [ ] 9.1 e2e harness using `@nestjs/testing` + `mongodb-memory-server`; reset DB between tests
- [ ] 9.2 AuthModule e2e: login success/failure, `/auth/me` with valid/missing/expired token, generic error parity
- [ ] 9.3 UsersModule e2e: CRUD happy path, self-delete blocked, duplicate username conflict, player-cannot-list
- [ ] 9.4 CampaignsModule e2e: listing for all three actors, 404 vs 403 semantics, player assignment rules, cascade delete
- [ ] 9.5 TerminalsModule e2e: create/import strips `login.users`, fictional user collection populated, round-trip export→import preserves content, update preserves live state, `load` excludes credentials
- [ ] 9.6 StateModule e2e: atomic multi-mutation, type-mismatch rejection, undeclared-variable rejection, anonymous mutation allowed on public campaign, anonymous mutation denied on private campaign, reset operations at all granularities
- [ ] 9.7 Guard composition unit tests for `JwtOptionalGuard`, `JwtRequiredGuard`, `AdminGuard`, `CampaignAccessGuard`, `TerminalAccessGuard`
- [ ] 9.8 Smoke test: spin up the app against `mongodb-memory-server`, hit `/health`, hit `/docs`

## 10. Operational

- [ ] 10.1 Dockerfile (Node LTS, multi-stage build)
- [ ] 10.2 `docker-compose.yml` for local dev (api + standalone mongo)
- [ ] 10.3 README documenting: env vars, bootstrap admin script, running tests, Swagger location, the public-mutation policy (D8)
- [ ] 10.4 Add npm scripts: `start:dev`, `start:prod`, `test`, `test:e2e`, `bootstrap:admin`
