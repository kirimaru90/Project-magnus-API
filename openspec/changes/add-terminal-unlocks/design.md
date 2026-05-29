## Context

The terminals module today exposes a `by-hidden-id` lookup that returns 404 for any non-existent or `meta.public === true` terminal — the only privacy gate in the system. List endpoints return every terminal in a campaign regardless of `meta.public`, and `TerminalAccessGuard` only verifies campaign-level access, not per-terminal privacy. Players who learn a terminal's mongo id can therefore hit `/terminals/:id/load` (or its state routes) directly, bypassing the intended "you must find the hidden slug first" puzzle gate.

There is also no server-side memory of "where was the user last?" — a useful affordance for the client to land returning users at the right campaign.

Three modules (`users`, `auth`, `terminals`) and one shared guard touch this change. Cascade behavior is the main subtlety: deletions in `campaigns` and `terminals` need to clean up state on every user, and the new fields need to self-heal on read paths in case a cascade is missed.

## Goals / Non-Goals

**Goals:**
- Per-user persistence of which hidden terminals a player has unlocked.
- Per-user persistence of the last campaign the user entered a terminal in.
- Privacy enforcement on every route that reads or mutates a non-public terminal, not just the by-hidden-id lookup.
- Cleanup semantics that survive cascade gaps (lazy self-heal on read for both fields).

**Non-Goals:**
- UI changes (frontend is out of scope; this is API-only).
- Surfacing unlock counts or "unlock leaderboards".
- Time-based expiry of `lastCampaignId`.
- Migration of existing user documents (defaults handle absent fields cleanly).
- Changing the existing 404-over-403 convention.
- Granting unlocks via any path other than `loadByHiddenId` (no admin "grant unlock" endpoint).

## Decisions

### D1. Storage: Mongoose `Map<string, string[]>` for `unlockedHiddenIds`

```ts
@Prop({ type: Map, of: [String], default: {} })
unlockedHiddenIds: Map<string, string[]>;
```

- `$addToSet` on `unlockedHiddenIds.<campaignId>` is a single atomic update.
- `$pull` from the same path handles terminal-deletion cascade and stale-unlock self-heal.
- `$unset` of `unlockedHiddenIds.<campaignId>` handles campaign-deletion cascade.
- Reads in the list filter are a single `user.unlockedHiddenIds.get(campaignId)`.

**Alternatives considered:**
- Flat `unlocks: string[]` of `"${campaignId}:${hiddenId}"` strings — atomic but loses structure and makes campaign-scoped cascade awkward (`$pull` with a regex).
- Separate `userTerminalUnlocks` collection — over-engineered for the scale here; adds a join to every list call.
- Array of `{ campaignId, hiddenId }` subdocs — requires `$elemMatch` and is harder to address with `$addToSet`.

### D2. `lastCampaignId` writes on load endpoints only, never on list

Two load endpoints write the field: `GET /terminals/:id/load` and `GET /campaigns/:id/terminals/by-hidden-id/:hiddenId`. The list endpoint (`GET /campaigns/:id/terminals`) deliberately does **not** write. Rationale: list calls happen on every UI navigation tick — using them as a signal would clobber the "last played" memory on bare browsing.

Admins write `lastCampaignId` too (no special-case). Anonymous callers skip the write (no user doc).

### D3. Unlock writes for players only

`loadByHiddenId` writes to `unlockedHiddenIds` only when the caller's role is `player`. Admins already see everything via list/access guards; storing their loads would make the field's meaning ambiguous ("earned access" vs. "ever loaded"). Skipping the write keeps the semantic clean and saves an IO per admin call.

### D4. Privacy check lives in `TerminalAccessGuard`, not in each service method

`TerminalAccessGuard` is used by five routes today (`/terminals/:id` detail, `/load`, `/fictional-login`, `/state` GET, `/state/mutate`). Pushing the privacy check into the guard means every route that protects a terminal stays consistent by default — and any future route that adopts the guard inherits the gate. The alternative (sprinkling `if (!isPublic && !hasUnlock) throw 404` in each service method) invites drift.

The guard signature must therefore have access to the user's `unlockedHiddenIds`. Two options:
- (a) Look up the user document inside the guard.
- (b) Have JwtStrategy enrich the request user with the full document.

**Chosen: (a)**. JwtStrategy currently returns `{ id, role }` (lean payload from the JWT). Loading the full user inside the guard, *only when needed* (i.e., only when the candidate terminal is non-public and the caller is not admin), keeps the common path (admin or public terminal) cheap.

### D5. Cascade-on-delete is eager; reads also self-heal

Two cascade hooks:
- `CampaignsService.delete` (or wherever campaign deletion lives): `User.updateMany({}, { $unset: { ['unlockedHiddenIds.' + campaignId]: '' } })` and `User.updateMany({ lastCampaignId: campaignId }, { $set: { lastCampaignId: null } })`.
- `TerminalsService.delete`: when the deleted terminal had `content.meta.hiddenId`, `User.updateMany({}, { $pull: { ['unlockedHiddenIds.' + campaignId]: hiddenId } })`.

In addition, two read paths self-heal in case the cascade ever missed:
- `loadByHiddenId` 404 path: if the caller is authenticated and their `unlockedHiddenIds.<campaignId>` contains the missing slug, `$pull` it before throwing 404.
- `/auth/me`: if `lastCampaignId` is set but the campaign no longer exists, unset and persist before responding.

Self-heal is per-user (only the calling user's document is updated). Eager cascade catches the global case at deletion time; self-heal catches the residual.

### D6. List filter pulls user unlocks once per request

In `listByCampaign(campaignId, actor)`:
- If `actor.role === 'admin'` → return everything (no user-doc fetch).
- Otherwise → fetch `user.unlockedHiddenIds.<campaignId>` once (or `[]` for anonymous), build a `Set<string>`, then filter the terminals by `meta.public === true || unlockedSet.has(meta.hiddenId)`.

One extra `User.findById(... )` call per non-admin list request. Acceptable.

### D7. List summary gains `hiddenId` for all callers that see the row

Because the list already filters out rows the caller hasn't unlocked, exposing `hiddenId` on the surviving rows leaks nothing the caller didn't already know. This lets the client offer a "your unlocked terminals" view with deep-links via the hiddenId route.

### D8. JwtOptionalGuard remains anonymous-tolerant

All affected routes use `JwtOptionalGuard` today. We keep that — anonymous access to public terminals must still work. The new logic in `TerminalAccessGuard` and `listByCampaign` simply treats "no user" as "player with no unlocks".

## Risks / Trade-offs

- **Extra DB read on every non-admin protected route** → Mitigation: read is keyed by user id (`_id` index, fast); only fires when the terminal is non-public. Could be cached per request via `Reflect`-stored value on `req` if measured to matter.
- **Cascade hook drift if new deletion paths appear** (e.g., bulk-delete admin tool) → Mitigation: centralize cascade in service methods; document the contract in this design and in `users` spec. The read-path self-heal acts as a safety net.
- **`Map<string, string[]>` serialization quirks** in Mongoose lean queries → Mitigation: use `.lean()` consistently and convert to plain object when returning from `/auth/me`. Test serialization shape.
- **Player who unlocked a hiddenId, then admin renamed the hiddenId via PUT** → after rename, the unlock entry is stale; the self-heal on `loadByHiddenId` will clean it on next visit. Until then, the entry is a harmless string that matches no terminal. Acceptable.
- **A `meta.public === true` terminal with a `hiddenId`** still appears in the list (it's public, everyone sees it) and `by-hidden-id` still returns 404 for it (that endpoint is hidden-only by existing spec). No unlock is created. Consistent with current behavior.
- **A private terminal with no `hiddenId`** becomes admin-only forever — there is no path for a player to unlock it. This is by design (D3 keeps the unlock semantics clean); admins can grant access by setting a `hiddenId` and sharing the slug, or by making the terminal public.

## Migration Plan

No data migration required:
- `lastCampaignId` defaults to `null` (Mongoose `default: null`).
- `unlockedHiddenIds` defaults to `{}` (Mongoose `default: {}`).
- Existing user documents read these as defaults until first write.

Deploy order:
1. Ship the schema additions and cascade hooks together with the guard/listing changes — they are all coupled (a deploy that ships the guard tightening without the user-field plumbing would lock players out of newly-private terminals they should be able to unlock).
2. No special rollback action needed beyond reverting the deploy; the new fields are additive and ignored by older code.

## Open Questions

- Should `/auth/me` cap the size of the returned `unlockedHiddenIds` map? Probably not for the current scale, but flag if the field grows unbounded in practice.
