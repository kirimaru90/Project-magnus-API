## Context

The RobCo Terminal Simulator today is a static SPA (`reference/index.html`) that loads flat JSON from `dati/` and performs plaintext password comparison in the browser. The architecture document (`reference/robco-terminal-architecture.md`) defines a three-component evolution — API, Backoffice, Terminal — communicating over HTTP/JSON, with the API as the single source of truth. This change builds the API in isolation; the Terminal and Backoffice are downstream consumers and are out of scope.

Constraints carried in from exploration:
- **Stack**: NestJS + Fastify adapter + TypeScript + MongoDB (Mongoose).
- **Auth**: single JWT access token, 24h expiry, no refresh tokens, no per-token revocation (rotate the signing secret to invalidate everything at once if needed).
- **Fictional credentials**: stored unencrypted in MongoDB, but never delivered to clients. Treated as narrative puzzle data, not real secrets.
- **Public campaigns**: unauthenticated callers may both read and mutate state. This is an explicit product decision, not an oversight.
- **State model**: embedded inside the owning document (`campaigns.state`, `terminals.state`) as a map of `key → {type, value, default}`. A single-document `$set`/`$inc` provides atomicity without requiring transactions, which matters because the deployment target is a standalone MongoDB instance.

## Goals / Non-Goals

**Goals:**
- Stand up a NestJS API that implements the full endpoint surface in §"Component: API" of the architecture doc.
- Provide a state engine that enforces schema (declared variables only, types match, unknown variables rejected) and supports atomic multi-mutation requests.
- Enforce the authorization matrix (admin / authenticated player / unauthenticated) at the route level via Guards.
- Ensure fictional credentials never leave the server: they live in their own collection and are stripped from any terminal-content response.
- Auto-generate OpenAPI documentation via `@nestjs/swagger`.

**Non-Goals:**
- Building the Backoffice or extending the existing Terminal client (`reference/index.html`).
- Real-time features (websockets, presence, push).
- Per-player progress tracking.
- Refresh-token flows, account lockout, multi-factor auth, audit logging.
- Migration tooling for the legacy `dati/*.json` flat format (will be a separate change).
- Replica-set MongoDB deployment or multi-document transactions.

## Decisions

### D1. NestJS + Fastify over Express adapter
NestJS gives us declarative Guards (clean fit for the admin/player/public matrix), a module system that maps 1:1 onto the architecture's domains (`AuthModule`, `UsersModule`, `CampaignsModule`, `TerminalsModule`, `StateModule`), and first-class Mongoose and JWT integrations. Fastify as the underlying HTTP adapter yields meaningfully better throughput than Express with no API surface cost.
**Alternatives considered:** FastAPI (rejected — Python is outside the existing JS ecosystem and the typed DTO story is less ergonomic for this team); plain Express (rejected — would re-invent module structure, DI, and Guards by hand).

### D2. JWT single access token (no refresh)
24-hour access tokens signed with HS256 and a server-side secret. No refresh tokens, no token-revocation store. The trade-off is explicit: revocation requires rotating the signing secret, which invalidates every active session. For an admin/player tool of this scale, that is acceptable; the complexity cost of a refresh-token + revocation store does not pay off.
**Alternatives considered:** access + refresh pair (rejected for complexity); opaque session tokens in DB (rejected — defeats statelessness and adds a per-request DB lookup).

### D3. MongoDB document layout with embedded state
Each campaign and terminal document embeds its state as a map of variable keys to `{type, value, default}` entries. This makes "apply N mutations atomically" trivially solvable by composing a single `updateOne` with `$set: { "state.k1.value": v1, "state.k2.value": v2 }`. MongoDB guarantees document-level atomicity, which satisfies the architecture's atomic-mutation requirement without any transaction support.
**Alternatives considered:** separate `terminal_state` and `campaign_state` collections (rejected — would force multi-document transactions for atomic mutations, which a standalone Mongo cannot provide); state in a single global state document per campaign (rejected — couples terminals to a shared write hotspot).

Document shapes:
```
users:
  { _id, username, passwordHash, role: 'admin' | 'player', createdAt }

campaigns:
  { _id, name, isActive, isPublic, players: [userId], state: { [key]: { type, value, default } }, createdAt, updatedAt }

terminals:
  { _id, campaignId, title, content: { meta, state, nodes, ... },        // login.users stripped
    state: { [key]: { type, value, default } }, createdAt, updatedAt }

fictionalUsers:
  { _id, terminalId, username, password }                                  // plaintext by design
```

Indexes:
- `users.username` unique.
- `terminals.campaignId`.
- `fictionalUsers.terminalId + username` unique compound.
- `campaigns.isActive + campaigns.isPublic` for the anonymous campaign listing.

### D4. Fictional credentials live in their own collection
On terminal create/import, the API extracts `content.login.users` into the `fictionalUsers` collection and removes them from the persisted content. There is no code path that reads `fictionalUsers` and merges them back into a response. This makes accidental leakage structurally hard rather than relying on response-shaping discipline.

### D5. State schema is derived from terminal content on import
The terminal's `content.state.local` declarations populate `terminals.state` with `value = default`. The `content.state.global` declarations populate `campaigns.state` with `value = default` **only when the key does not already exist** in the campaign (first-declaration-wins, per the architecture). The same projection runs on terminal updates, but with **additive semantics**: new variables in the updated content are added with their defaults; variables removed from the schema are left orphaned in `terminals.state` (the admin can explicitly reset them later). This is the safer of the two options discussed in exploration and avoids accidentally wiping live state when an author removes a variable.

### D6. Mutation validation pipeline
A mutation request `[{ key, op, value | by }, ...]` is processed as:
1. Resolve each `key` as `scope.varName` (`local.foo` or `global.foo`). Reject if `scope` is not `local` or `global`.
2. Load the relevant document (terminal for `local`, campaign for `global`).
3. Confirm `varName` exists in `document.state`. Reject 400 if not declared.
4. Confirm the value type for the `op` matches the declared `type` (e.g., `increment` requires `type: number`, `toggle` requires `type: boolean`, `set` requires the supplied value's type to match).
5. Build a single Mongo update operator object (`$set`/`$inc`) covering all mutations and call `updateOne` with the targeted document `_id`.
6. Refetch and return the new state snapshot.

Cross-document mutation requests (mixed `local.` and `global.` in one batch) are **not supported in this design**; they would require a transaction. If a client needs both, it issues two requests against the appropriate endpoints. This is a deliberate scope cut, not a forever-no.

### D7. Authorization Guards
Three Guards compose to cover every route:
- `JwtOptionalGuard` — extracts and verifies a JWT if present; sets `req.user`. Never rejects.
- `JwtRequiredGuard` — same, but 401 if no/invalid token.
- `AdminGuard` — requires `req.user.role === 'admin'`.
- `CampaignAccessGuard` — for any route scoped to a campaign id, accepts: admin; or player with the campaign in their assignment list; or anonymous when the campaign is `isActive && isPublic`.
- `TerminalAccessGuard` — resolves the terminal to its campaign and reuses `CampaignAccessGuard`'s logic.

Mutation routes on public campaigns require **no authentication** by D-decision (see D8). They still go through `CampaignAccessGuard` so that mutation against an inactive campaign is rejected.

### D8. Public means public for writes too
On public campaigns, any caller — including unauthenticated — can mutate state. This is the product call from exploration. The architecture doc flagged it as an open point; we are closing it on the permissive side. Rate limiting can be added later as a separate cross-cutting concern; for the initial implementation, we accept the risk that anonymous users can corrupt public campaign state.

### D9. Validation via DTOs + class-validator
Every controller route declares a typed DTO with `class-validator` decorators. Nested validation is used for the mutation payload, the import payload (terminal content schema), and the condition syntax. The mutation DTO does cheap structural validation; semantic validation (variable exists, type matches) is done in the service layer where the document context is available.

### D10. Bcrypt for real-user passwords, plaintext for fictional
`users.passwordHash` is bcrypt with cost factor 12. `fictionalUsers.password` is stored as supplied. The two are different security domains: a real-user password compromise grants access to the system; a fictional-user password compromise reveals a narrative puzzle answer.

## Risks / Trade-offs

- **Anonymous write abuse on public campaigns** → Acceptable for initial release. Mitigation deferred to a future rate-limit / abuse-detection change. Operators can disable public access on a campaign at any time via `isPublic = false`.
- **JWT rotation invalidates all sessions** → Acceptable. Document this in the operator runbook. The signing secret lives in env and is meant to be stable.
- **Orphaned state variables when a schema is reduced** → By design (D5). Surfaces in a future Backoffice "state inventory" view; the admin can explicitly reset.
- **Fictional credentials stored plaintext** → Explicit product decision. The collection is server-only and never serialized in any response; risk is bounded to direct DB access. Mitigation: ensure backups are encrypted at rest and access to MongoDB is restricted.
- **Standalone MongoDB lacks transactions** → Mitigated by the embedded-state design (D3). The only mutation that would benefit from a transaction is "delete a campaign and all its terminals/fictional users/state" — we handle this with best-effort sequential deletes and accept that a crash mid-delete may leave orphans; a periodic cleanup job can sweep these later if it becomes an issue.
- **Mongo document size** for very large terminals (thousands of nodes) → 16MB BSON limit is far above any realistic terminal content. Not a concern at design scale.
- **No audit trail** → Out of scope (listed as a Nice to Have in the architecture). Add later via a `audit_events` collection if needed.

## Migration Plan

There is nothing to migrate. The API is greenfield. The existing `reference/index.html` terminal client continues to read its static `dati/` files until the future Terminal-extension change wires it to the API. Operators stand up the API independently:

1. Provision MongoDB (standalone is fine).
2. Set `JWT_SECRET`, `MONGO_URL`, `PORT`, `CORS_ALLOWED_ORIGINS` env vars.
3. Run a one-time bootstrap script that creates the first admin user (script reads `BOOTSTRAP_ADMIN_USERNAME` and `BOOTSTRAP_ADMIN_PASSWORD` from env and exits).
4. Start the API. Use it via Swagger UI at `/docs` or via direct HTTP.

Rollback is "stop the process and drop the database" — there is no upstream system depending on it yet.

## Open Questions

- **PWA / service worker caching on the Terminal client** — out of scope for this change; flagged here so it isn't lost when the Terminal-extension change lands.
- **Backoffice authorability of fictional passwords** — the API stores them plaintext and returns them only to admins on terminal read (since they need to author puzzles). Confirm: does an admin GET on a terminal return the fictional users? Current decision: **yes for admins, no for everyone else**, scoped via response shaping in the controller. Revisit if the Backoffice change wants different behavior.
- **Bootstrap admin flow** — a CLI script is the current plan; alternative is a first-run self-registration endpoint. CLI is simpler and avoids an "is the system bootstrapped?" branch in the auth flow.
