## Context

Terminals are stored as Mongo documents (`api/src/terminals/schemas/terminal.schema.ts`) and served through `TerminalsService`. Two endpoints load a terminal for playback:

- `GET /terminals/:id/load` → `TerminalsService.load(id)`
- `GET /campaigns/:id/terminals/by-hidden-id/:hiddenId` → `TerminalsService.loadByHiddenId(campaignId, hiddenId)`

Both are protected by `JwtOptionalGuard`, so the caller may be an admin, an assigned player, or anonymous. The authenticated actor is available on the request as `req.user` but is currently **not** passed into either load method. The campaign terminal list is produced by `listByCampaign` → `toSummary`, which today returns `id`, `campaignId`, `title`, `isPublic`, and timestamps.

Configuration is centralized in `api/src/config/configuration.ts` as a plain factory reading `process.env` with sensible defaults, consumed via Nest's `ConfigService`.

## Goals / Non-Goals

**Goals:**
- Persist a monotonically increasing `viewCount` per terminal.
- Increment on each playback load (by id and by hiddenId).
- Suppress admin-driven increments unless explicitly enabled by config (default off).
- Surface `viewCount` in the campaign terminal list.

**Non-Goals:**
- No per-user / per-session deduplication — every qualifying load counts.
- No view history, audit log, or time-series breakdown — just a running total.
- The `GET /terminals/:id` detail endpoint does **not** increment (it is an authoring/inspection view, not a playback load).
- No backfill of historical view data; existing terminals start effectively at `0`.

## Decisions

### Store `viewCount` as a top-level schema field
Add `@Prop({ type: Number, default: 0 }) viewCount: number` to the `Terminal` schema. A top-level numeric field (not nested in `content`) keeps it server-owned, queryable, and trivially incrementable with an atomic operator. Existing documents without the field read as `0` via the schema default and the `$inc` upsert-free semantics.

**Alternative considered:** nesting under `content.meta`. Rejected — `content` is client-supplied import/export data and is round-tripped through export; mixing a server-owned counter into it complicates stripping and round-trip guarantees.

### Increment atomically with `$inc`
Use `terminalModel.updateOne({ _id }, { $inc: { viewCount: 1 } })` rather than read-modify-write. This avoids race conditions under concurrent loads and is a single round-trip. The increment is fire-and-forget relative to the response payload; the returned `content`/state come from the document already fetched.

**Note on returned value:** the load response does not currently return `viewCount`, and the requirement only asks for it in the list. We therefore do not need the post-increment value in the load path, so a plain `$inc` (not `findOneAndUpdate`) suffices.

### Pass the actor into the load methods to gate admin counting
The controller already has `req.user` (via `JwtOptionalGuard`). Thread it into `load(id, actor?)` and `loadByHiddenId(campaignId, hiddenId, actor?)`. The service decides: increment when the actor is not an admin, OR when the actor is an admin and `config.terminals.countAdminViews` is `true`.

**Alternative considered:** doing the admin check in the controller and passing a boolean `shouldCount`. Rejected — keeps the policy split across layers; centralizing the decision in the service (which already injects collaborators) is cleaner and easier to test.

### Config via `ConfigService`
Add `terminals: { countAdminViews: process.env.TERMINAL_COUNT_ADMIN_VIEWS === 'true' }` to `configuration.ts` (default `false` because any value other than the literal `'true'` is falsey). Inject `ConfigService` into `TerminalsService` to read `terminals.countAdminViews`. Document `TERMINAL_COUNT_ADMIN_VIEWS` in `.env`.

## Risks / Trade-offs

- **[Inflated counts from bots/crawlers]** → Out of scope; the counter measures raw loads by design. Can be revisited with dedup later.
- **[Admin authoring inflates counts when flag enabled]** → Documented behavior; the flag defaults to `false` precisely to avoid this during normal authoring.
- **[Extra write on every load adds DB load]** → A single indexed `$inc` is cheap; acceptable for expected traffic. If it becomes hot, batching/async could be introduced without changing the contract.
- **[Actor unavailable if guard changes]** → The increment treats a missing/non-admin actor as a countable view, which is the safe default (players and anonymous always count).
