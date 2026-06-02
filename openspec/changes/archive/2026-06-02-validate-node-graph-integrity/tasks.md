## 1. Node graph integrity validation

- [x] 1.1 Add a private `validateNodeGraph(nodes: Record<string, unknown>): void` helper
  in [terminals.service.ts](../../../api/src/terminals/terminals.service.ts). It must
  collect every `choices[].target` string from top-level node objects and from
  `variants[].choices[].target`, deduplicate, and throw `BadRequestException` with a
  message listing all targets not found in `Object.keys(nodes)`.
- [x] 1.2 Call `validateNodeGraph(dto.nodes)` at the top of `create()` in
  [terminals.service.ts](../../../api/src/terminals/terminals.service.ts), before
  `contentWithoutUsers()` and before any DB interaction.
- [x] 1.3 Call `validateNodeGraph(dto.nodes)` at the top of `update()` in the same file,
  before `contentWithoutUsers()` and before any DB interaction. (Import is covered via
  `create()`.)

## 2. Login block cleanup

- [x] 2.1 Fix `stripContent()` in [terminals.service.ts](../../../api/src/terminals/terminals.service.ts):
  instead of replacing `users` with `[]`, check whether the stored `users` array is
  non-empty; if so leave the block as-is (usernames are already password-free); if empty
  or absent, `delete stripped.login`.
- [x] 2.2 Fix `contentWithoutUsers()` in the same file: change the guard from
  `if (dto.login)` to `if (dto.login?.users?.length)` so an empty `LoginBlockDto` does
  not persist a vacuous `login: { users: [] }` in stored content.

## 3. Tests

- [x] 3.1 In `api/test/terminals.e2e-spec.ts` (or a dedicated spec): POST/PUT with a
  `choices[].target` pointing to a missing node key → HTTP 400; error message names the
  dangling target.
- [x] 3.2 Same test file: POST/PUT with a `variants[].choices[].target` pointing to a
  missing node → HTTP 400.
- [x] 3.3 Same test file: POST/PUT where all `choices[].target` values resolve → HTTP
  201/200 (regression guard).
- [x] 3.4 Same test file: `GET /terminals/:id/load` for a terminal with fictional users →
  `content.login.users` is an array of `{username}` objects (not `[]`); no `password`
  field present in any element.
- [x] 3.5 Same test file: `GET /terminals/:id/load` for a terminal with no fictional users
  → response body contains no `login` key.
- [x] 3.6 Same test file (or `by-hidden-id` spec): `GET /campaigns/:id/terminals/by-hidden-id/:hiddenId`
  for a terminal with fictional users → same `content.login.users` contract as 3.4.

## 4. Spec update

- [x] 4.1 Add a "Node graph integrity" requirement to
  [openspec/specs/terminals/spec.md](../../../openspec/specs/terminals/spec.md)
  covering: dangling `choices[].target` → 400; valid targets → 201; include at least two
  scenarios (dangling target rejected; all targets valid accepted).
- [x] 4.2 Update the "Reading terminal detail and playback" requirement in the same spec
  to document the `content.login.users` contract on load: present with username objects
  when fictional users exist; key absent when no users.

## 5. Verification

- [x] 5.1 Run `npm run lint` and `npm run test:e2e` in `api/`; all green.
- [ ] 5.2 Manually verify: PUT the "guida" terminal payload (which has a
  `demo_login_protetto` choice target not defined in `nodes`) → confirm HTTP 400 naming
  `demo_login_protetto`; add the missing node → confirm HTTP 200.
