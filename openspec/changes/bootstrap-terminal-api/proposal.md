## Why

The RobCo Terminal Simulator currently runs as a pure static site: terminals are flat JSON files in a `dati/` directory, fictional passwords are compared in the browser, and there is no notion of campaigns or persistent state. The architecture documented in `reference/robco-terminal-architecture.md` evolves this into a server-backed system with multiple campaigns, shared persistent state, real authentication, and a backoffice for non-technical authoring. The API is the cornerstone of that evolution — it is the authoritative source of truth that both the Terminal client and the future Backoffice will depend on. Without it, neither the state engine nor real auth nor multi-user authoring is possible.

## What Changes

- Introduce a new NestJS application as the API server (TypeScript, Fastify adapter, MongoDB via Mongoose).
- Implement real-user authentication with JWT single access tokens (24h expiry); two roles: `admin` and `player`.
- Implement campaign management: CRUD, active/inactive toggle, public/private toggle, player assignment.
- Implement terminal management: CRUD, JSON export, JSON import (with schema validation, first-declaration-wins for global state).
- Implement state engine: per-terminal local state and per-campaign global state stored as embedded maps in their owning documents; atomic multi-mutation updates via single-document `$set`/`$inc`; reset operations at variable, terminal, and campaign granularity.
- Implement terminal playback endpoint: returns terminal content with fictional credentials stripped, plus current state snapshot.
- Implement fictional login endpoint: validates credentials server-side against plaintext-stored fictional users, never exposing them to clients.
- Enforce authorization rules: admins access all routes; players access only their assigned campaigns + active public campaigns; unauthenticated requests access only active public campaigns; state mutations on public campaigns are accepted from unauthenticated callers by design.
- Provide OpenAPI/Swagger documentation auto-generated from controller and DTO decorators.

## Capabilities

### New Capabilities

- `auth`: Real-user login/logout, JWT issuance and verification, current-session inspection, role-based access primitives.
- `users`: Admin CRUD over real users (`admin` and `player` roles), password reset.
- `campaigns`: CRUD over campaigns, public/active toggles, player membership management, listing rules for admin/player/anonymous callers.
- `terminals`: CRUD over terminals scoped to a campaign, JSON import/export with schema validation, content delivery with fictional-credential stripping, fictional login validation.
- `state-engine`: Embedded-document state model, mutation operations (set/increment/toggle/append), variable- and scope-level reset, schema-driven validation of mutations, atomic multi-mutation requests.

### Modified Capabilities

<!-- None — this is the initial API; there are no existing specs to modify. -->

## Impact

- **New codebase**: a fresh NestJS project rooted at the repository (or a chosen subdirectory). No existing code is touched; the current `reference/index.html` terminal engine is untouched by this change and continues to operate against its static `dati/` files until the future Terminal-extension change.
- **New runtime dependencies**: Node.js (LTS), MongoDB (standalone is fine), `@nestjs/*`, `fastify`, `mongoose`, `@nestjs/jwt`, `@nestjs/passport`, `passport-jwt`, `bcrypt`, `class-validator`, `class-transformer`, `@nestjs/swagger`.
- **New environment surface**: connection string for MongoDB, JWT signing secret, listen port, CORS origin allowlist.
- **Out of scope for this change**: the Backoffice web app and any extension of the existing terminal client (`reference/index.html`). Both are downstream consumers of this API and will be addressed in their own change proposals.
- **Security posture**: fictional credentials stored unencrypted by explicit decision (treated as narrative puzzle data, not real secrets); real-user passwords stored as bcrypt hashes; JWT secret must be rotated out-of-band if compromised since tokens are stateless and not revocable individually in this initial design.
