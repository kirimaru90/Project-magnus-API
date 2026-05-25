## Why

The terminal list endpoint (`GET /campaigns/:id/terminals`) returns a summary for each terminal including an `isPublic` flag. The Terminal client renders public terminals as buttons and exposes an "INSERISCI NOME ARCHIVIO" free-text input for accessing hidden ones. However, the API currently has no endpoint to resolve a human-readable `meta.id` (the author-defined slug embedded in the terminal content, e.g. `"super-duper-admin"`) to a playable terminal. Hidden terminals can only be accessed if the caller already knows the MongoDB ObjectId, which is never surfaced to players. This makes the hidden-terminal UX flow non-functional.

## What Changes

- Add a compound unique index on `(campaignId, content.meta.id)` in the Terminal collection, enforcing that no two terminals within the same campaign share the same `meta.id`.
- Add `GET /campaigns/:id/terminals/by-meta/:metaId` — a new read endpoint that resolves a `meta.id` slug to a playable terminal, returning the same payload as `GET /terminals/:id/load`. Restricted to non-public terminals only (`meta.public` absent or `false`); calling it with the `meta.id` of a public terminal returns 404.
- Access rules mirror those of the terminal list: admin always; player only for assigned or public-active campaigns; anonymous only for public-active campaigns.

## Capabilities

### Modified Capabilities

- `terminals`: adds the slug-lookup endpoint and its backing index; adds the uniqueness invariant for `(campaignId, meta.id)`.

## Impact

- **Schema change**: a new unique index is added to the `terminals` collection. On a non-empty database this index creation may fail if duplicate `(campaignId, content.meta.id)` pairs exist — a one-time migration/cleanup is required before deploying if that is the case.
- **Conflict behavior on create/update**: attempting to create or import a terminal whose `meta.id` already exists in the campaign now returns HTTP 409 (handled by the existing `MongooseExceptionFilter`).
- **No breaking changes**: existing routes are unaffected; the new endpoint is purely additive.
- **Out of scope**: promoting `meta.id` to a top-level Terminal schema field; updating the Terminal client to use this endpoint (downstream concern).
