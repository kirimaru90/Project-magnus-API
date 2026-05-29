## Why

Players need a way to discover and persistently re-enter "hidden" (non-public) terminals they've found via `hiddenId`, and clients need a "last campaign" memory to land users back where they were. Today, every list call returns every terminal in a campaign regardless of `meta.public`, and the only privacy gate is at the `by-hidden-id` lookup — meaning a player who learns a terminal's mongo id can hit `/terminals/:id/load` directly. This change closes that gap and gives the user document the small amount of state needed to remember per-user unlocks plus the last-visited campaign.

## What Changes

- **User schema** gains two fields:
  - `lastCampaignId: string | null` — campaign of the most recently loaded terminal for that user.
  - `unlockedHiddenIds: Map<campaignId, string[]>` — per-campaign list of `hiddenId` slugs the user has unlocked via the by-hidden-id route.
- **`GET /auth/me`** response gains both new fields. If `lastCampaignId` points to a campaign that no longer exists, it is lazily unset on read and returned as `null`.
- **`GET /campaigns/:id/terminals`** filters out terminals where `content.meta.public !== true`, except for admin callers (see all) and player callers who have unlocked the terminal's `hiddenId`. Anonymous callers see only public terminals. The list summary also gains an optional `hiddenId` field, present when `content.meta.hiddenId` is set.
- **`TerminalAccessGuard`** gains a privacy check applied to every route it protects (`GET /terminals/:id`, `GET /terminals/:id/load`, `POST /terminals/:id/fictional-login`, `GET /terminals/:id/state`, `POST /terminals/:id/state/mutate`). Non-admin callers who have not unlocked a non-public terminal receive HTTP 404 (consistent with the existing "404 over 403" convention).
- **Write triggers** on load endpoints:
  - `GET /terminals/:id/load` and `GET /campaigns/:id/terminals/by-hidden-id/:hiddenId` set `user.lastCampaignId` for any authenticated caller.
  - `GET /campaigns/:id/terminals/by-hidden-id/:hiddenId` additionally `$addToSet` the slug into `user.unlockedHiddenIds.<campaignId>` for **player** callers only. Admins do not write — unlocks represent earned access, not "ever loaded".
- **Cascade-on-delete** for both new fields:
  - Campaign deletion clears `lastCampaignId` on users where it matches and `$unset`s the per-campaign entry in `unlockedHiddenIds`.
  - Terminal deletion `$pull`s the terminal's `hiddenId` from every user's `unlockedHiddenIds.<campaignId>` (when the terminal had a `hiddenId`).
- **Self-heal on stale unlock**: when `GET /campaigns/:id/terminals/by-hidden-id/:hiddenId` 404s and the authenticated caller has that slug in their unlock list for the campaign, the slug is `$pull`ed before the 404 is thrown.

Out of scope: UI changes, surfacing unlock counts, time-based expiry of `lastCampaignId`.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `users`: adds `lastCampaignId` and `unlockedHiddenIds` to the user document, plus cascade-on-delete rules tied to campaign and terminal deletion.
- `auth`: `GET /auth/me` exposes the two new fields and lazily self-heals a stale `lastCampaignId`.
- `terminals`: list filter, `hiddenId` in list summary, `TerminalAccessGuard` privacy check across all routes it covers, write triggers on load endpoints, self-heal on stale unlock in the by-hidden-id route.

## Impact

- **Code**: `User` Mongoose schema; `AuthService.me`; `TerminalsService.listByCampaign`, `load`, `loadByHiddenId`, `delete`; `CampaignsService.delete` (or equivalent cascade hook); `TerminalAccessGuard`; tests across all three modules.
- **API contracts**: `GET /auth/me` response shape grows. `GET /campaigns/:id/terminals` response items grow an optional `hiddenId` field and the visible row set shrinks for non-admins. `TerminalAccessGuard` returns HTTP 404 in more cases for non-admin callers.
- **Data**: existing user documents need no migration — both new fields default cleanly (`null` and `{}` respectively) and Mongoose will treat absent fields as defaults on read.
- **Dependencies**: none added.
- **Reference docs**: `reference/campaigns-terminals-api-io.md` and any auth/me documentation will need updates after implementation.
