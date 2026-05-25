## Why

Operators need to know how often each terminal is actually played to gauge engagement, but the API currently tracks nothing about terminal access. We want a simple per-terminal view counter that reflects real player interest without being inflated by admins inspecting their own content during authoring.

## What Changes

- Add a `viewCount` field to the terminal record (integer, default `0`).
- Increment `viewCount` whenever a terminal is loaded for playback:
  - `GET /terminals/:id/load` (loaded by id)
  - `GET /campaigns/:id/terminals/by-hidden-id/:hiddenId` (loaded by hiddenId)
- Add a configuration flag (env var `TERMINAL_COUNT_ADMIN_VIEWS` surfaced as config key `terminals.countAdminViews`) that controls whether admin loads are counted. Default is `false`.
- When an **admin** loads a terminal, `viewCount` increments **only if** `terminals.countAdminViews` is `true`. Player and anonymous loads always increment.
- Include `viewCount` for each terminal in the list response (`GET /campaigns/:id/terminals`).

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `terminals`: terminal records gain a `viewCount` field; the two playback (load) endpoints increment it subject to an admin-counting configuration flag; the campaign terminal list returns `viewCount` per terminal.

## Impact

- **Schema**: `api/src/terminals/schemas/terminal.schema.ts` — add `viewCount` prop.
- **Service**: `api/src/terminals/terminals.service.ts` — increment logic in `load` and `loadByHiddenId`; expose `viewCount` in `toSummary`. The load methods need the authenticated actor to decide whether an admin view counts.
- **Controller**: `api/src/terminals/terminals.controller.ts` — pass the request actor (`req.user`) into `load` and `loadByHiddenId`.
- **Config**: `api/src/config/configuration.ts` — add `terminals.countAdminViews` from `TERMINAL_COUNT_ADMIN_VIEWS` (default `false`); document the env var in `.env`.
- **Spec**: `openspec/specs/terminals/spec.md` — delta covering the new field, increment behavior, and list output.
- No breaking changes; new field is additive and defaults to `0`.
