## 1. State declaration validation (enum requires values)

- [x] 1.1 Add a custom class-validator decorator (e.g. `@IsStateVarMap()`) under `api/src/terminals/dto/` that validates a `Record<string, StateVarDto>`: each entry is an object, `type` ∈ `{boolean, number, enum, string}`, and when `type === 'enum'` then `values` is a non-empty array of strings; when `values` is present every element is a string. Error messages must name the offending variable.
- [x] 1.2 Apply `@IsStateVarMap()` to `StateDeclarationDto.local` and `.global` in [terminal-content.dto.ts](../../../api/src/terminals/dto/terminal-content.dto.ts), replacing the bare `@IsObject()`. Keep `@IsOptional()`.
- [x] 1.3 Reuse a single source of truth for the allowed `type` set so the decorator and `StateVarDto` cannot drift (export the union/const from the DTO module).
- [x] 1.4 Verify the global ValidationPipe surfaces these as HTTP 400 (no controller changes expected).

## 2. Clean 409 on duplicate hiddenId

- [x] 2.1 In [terminals.service.ts](../../../api/src/terminals/terminals.service.ts) `create()`, wrap the `terminalModel.create(...)` call; on a caught MongoDB duplicate-key error (`error.code === 11000`) throw `ConflictException` with a message naming `dto.meta.hiddenId`.
- [x] 2.2 In `update()`, wrap the `findByIdAndUpdate(...)` that writes `content`; translate the same `11000` error into the same `ConflictException`.
- [x] 2.3 Add a small helper to detect the duplicate-key error by `code === 11000` (no message-text parsing) and import `ConflictException` from `@nestjs/common`.

## 3. increment defaults `by` to 1 (verify)

- [x] 3.1 Confirm `item.by ?? 1` is applied on both the local and global increment paths in [state.service.ts](../../../api/src/state/state.service.ts) (no code change expected; adjust only if a gap is found).

## 4. Optional / partial state projection

- [x] 4.1 Confirm `projectState()` and `update()` in [terminals.service.ts](../../../api/src/terminals/terminals.service.ts) never throw when `state`, `state.local`, or `state.global` is absent, and that missing scopes yield `{}`.
- [x] 4.2 Normalize stored `content.state` in `contentWithoutUsers()` so a stateless terminal reads/exports consistently (store an object, not `undefined`); ensure the result still re-imports cleanly.

## 5. Tests

- [x] 5.1 In `api/test/terminals.e2e-spec.ts`: enum declaration without `values` → 400 on create, import, and update; enum with non-empty `values` → 201; invalid `type` → 400.
- [x] 5.2 In `api/test/terminals.e2e-spec.ts`: duplicate `hiddenId` → 409 on create, import, and update; same `hiddenId` across different campaigns → 201.
- [x] 5.3 In `api/test/terminals.e2e-spec.ts`: create with no `state`, with only `state.local`, and with only `state.global` all succeed and project missing scopes to `{}`; export→import round-trip of a stateless terminal succeeds.
- [x] 5.4 In `api/test/state.e2e-spec.ts`: `increment` with no `by` adds exactly 1 on both `local` and `global` paths.

## 6. Verification

- [ ] 6.1 Run `npm run lint` and `npm run test:e2e` in `api/`; all green.
- [ ] 6.2 Spot-check that existing valid terminals (with proper enum `values`) still create/import/update without regression.
