## 1. Schema

- [x] 1.1 Add compound unique index `{ campaignId: 1, 'content.meta.id': 1 }` to `TerminalSchema` in `terminal.schema.ts`

## 2. Service

- [x] 2.1 Add `TerminalsService.loadByMetaId(campaignId: string, metaId: string)`: query `{ campaignId, 'content.meta.id': metaId, 'content.meta.public': { $ne: true } }`, throw `NotFoundException` if no result, then return the same payload as `load()` (`{ content, localState, globalState }`)

## 3. Controller

- [x] 3.1 Add `GET /campaigns/:id/terminals/by-meta/:metaId` to `TerminalsController`, guarded by `JwtOptionalGuard` + `CampaignAccessGuard`, delegating to `terminalsService.loadByMetaId(id, metaId)`

## 4. Tests

- [x] 4.1 e2e: authorized caller resolves a non-public terminal by `meta.id` → 200 with load payload
- [x] 4.2 e2e: `meta.public === true` terminal not resolvable → 404
- [x] 4.3 e2e: absent `meta.public` treated as non-public → 200
- [x] 4.4 e2e: unknown `meta.id` → 404
- [x] 4.5 e2e: anonymous caller on private campaign → 404
- [x] 4.6 e2e: duplicate `meta.id` on create within same campaign → 409
- [x] 4.7 e2e: same `meta.id` allowed across different campaigns → 201
