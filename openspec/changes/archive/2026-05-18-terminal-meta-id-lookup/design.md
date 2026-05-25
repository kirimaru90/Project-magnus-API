## Context

The Terminal's hidden-archive flow requires resolving a human-readable `meta.id` slug to a playable terminal. The `meta.id` field lives inside the opaque `content` blob (`content.meta.id: string`), which is stored as a `Mixed` field in Mongoose. The lookup must be scoped to a campaign (for access control and query efficiency) and must only match non-public terminals.

## Decisions

### D1. Index on `content.meta.id` via dot-notation, not schema promotion

`meta.id` is embedded inside `content: Mixed`. We could promote it to a top-level field on the Terminal document for cleaner indexing, but that would require a schema migration and would duplicate data already authoritative inside `content`. MongoDB supports dot-notation indexes on subdocuments inside Mixed fields (`'content.meta.id'`), which gives the same query performance without schema churn.

The index is a **compound unique** index on `{ campaignId: 1, 'content.meta.id': 1 }` (non-sparse, since `meta.id` is required by the DTO and every terminal document has it). This enforces the invariant that `meta.id` is unique within a campaign at the database level.

**Alternatives considered:** plain (non-unique) index — rejected because duplicate `meta.id` within a campaign makes the lookup semantically ambiguous; top-level `metaId` field — rejected for migration cost and data duplication.

### D2. Restrict to non-public terminals; public slug resolves as 404

The hidden-terminal UX flow is specifically for terminals that are not listed as buttons (`meta.public !== true`). Resolving a public terminal via `meta.id` would mean a public terminal has two access paths (button and slug), which is confusing and not the intended product behavior. Returning 404 for public terminals also prevents information leakage about what slugs are assigned to public terminals.

The service query filter: `{ campaignId, 'content.meta.id': metaId, 'content.meta.public': { $ne: true } }`.

`$ne: true` correctly handles all three cases: `false`, `undefined`, and absent field — all treated as non-public.

### D3. Return the full load payload, not just the terminal ID

The Terminal client needs to call `GET /terminals/:id/load` after resolving the slug anyway. Combining both into a single endpoint saves a round-trip and avoids the client needing to extract and store a transient MongoDB ObjectId. The response shape is identical to `/terminals/:id/load`: `{ content, localState, globalState }`.

**Alternative considered:** return only `{ id }` and let the client chain to `/load` — rejected because it adds a round-trip for no architectural benefit; the load payload is the only thing the client needs from this flow.

### D4. Route shape `GET /campaigns/:id/terminals/by-meta/:metaId`

Scoping the route under `/campaigns/:id/` allows the existing `CampaignAccessGuard` to handle access control before any terminal lookup occurs. It also makes the campaign context explicit in the URL, which is necessary because `meta.id` is only unique within a campaign, not globally.

The path segment `by-meta` avoids collision with the future possibility of a `/campaigns/:id/terminals/:terminalId` shape, and signals the lookup semantics clearly.

## Endpoint Specification

```
GET /campaigns/:id/terminals/by-meta/:metaId

Guards:   JwtOptionalGuard → CampaignAccessGuard
Auth:     same rules as GET /campaigns/:id/terminals
          (admin always; player if assigned or public-active; anonymous if public-active)

Query:    db.terminals.findOne({
            campaignId: ObjectId(id),
            'content.meta.id': metaId,
            'content.meta.public': { $ne: true }
          })

Response 200:
  {
    "content":     { ... },   // stripped of login.users (same as /load)
    "localState":  { key: value, ... },
    "globalState": { key: value, ... }
  }

Response 404:
  - campaign does not exist or caller cannot access it  (CampaignAccessGuard)
  - no terminal with that meta.id in that campaign
  - terminal found but meta.public === true
  All three cases return identical 404 (no distinction, no existence leak)
```

## Index

```typescript
TerminalSchema.index(
  { campaignId: 1, 'content.meta.id': 1 },
  { unique: true }
);
```

This replaces the existing single-field `campaignId` index for queries that include `meta.id`; the `campaignId` single-field index (used by `listByCampaign`) is retained separately.
