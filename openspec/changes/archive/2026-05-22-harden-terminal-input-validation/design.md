## Context

The terminal authoring guide specifies validation rules the API is supposed to
enforce at create/import/update time. Reading the current code reveals four
discrepancies, two of which are subtler than the proposal implies:

- **State variable maps are not deep-validated at all.** In
  [terminal-content.dto.ts](../../../api/src/terminals/dto/terminal-content.dto.ts),
  `StateDeclarationDto.local` and `.global` are typed `Record<string, StateVarDto>`
  but decorated only with `@IsObject()`. There is no `@ValidateNested`/`@Type`,
  and class-validator/class-transformer do not deep-validate the *values* of a
  dynamically-keyed object map. As a result, **none** of `StateVarDto`'s
  validators run today — not the `@IsEnum` on `type`, not the `values`
  constraint. An enum without `values` passes, and so does a bogus `type`.
- **`increment` already defaults `by` to 1.** [state.service.ts](../../../api/src/state/state.service.ts)
  uses `item.by ?? 1` on both the local (line 144) and global (line 228) paths.
  This item is verification + a regression test, not a code change.
- **Duplicate `hiddenId`** is guarded by a partial unique index on the terminal
  schema, so `terminalModel.create()`/`findByIdAndUpdate()` throw a MongoDB
  E11000 error that is currently unhandled and surfaces as a 500.
- **Absent state** is already largely tolerated: `projectState()` uses
  `dto.state?.local ?? {}` and guards the global branch on `dto.state?.global`.
  The functional state map (`terminal.state`) defaults to `{}` via the schema.
  The work here is to guarantee and test it, and to keep stored `content.state`
  consistent.

## Goals / Non-Goals

**Goals:**
- Reject enum declarations lacking a non-empty `values` array at
  create/import/update with HTTP 400.
- Make `StateVarDto` validation actually run on every declared variable (a
  necessary consequence of the above), closing the broader "state vars are not
  validated" gap.
- Return HTTP 409 (not 500) on a `hiddenId` collision within a campaign, with a
  message naming the conflicting slug.
- Guarantee `increment` with no `by` adds 1 (verify + test).
- Guarantee create/import/update accept absent or partial (`local`-only /
  `global`-only) state and project missing scopes to `{}`.

**Non-Goals:**
- Validating that an enum's `default` is one of its `values` (explicitly parked).
- Validating `nodes` structure (intentionally free-form per the guide).
- Any change to [reference/terminal-authoring-guide.md](../../../reference/terminal-authoring-guide.md).
- User-scoped state (dropped from this change).

## Decisions

### 1. Deep-validate state maps with a custom validator decorator

**Decision:** Add a custom class-validator decorator (e.g. `@IsStateVarMap()`)
applied to `StateDeclarationDto.local` and `.global`, replacing the bare
`@IsObject()`. It validates that the property is a plain object and, for each
entry, that:
- the value is an object,
- `type` is one of `boolean | number | enum | string`,
- when `type === 'enum'`, `values` is present and is a **non-empty array of
  strings**,
- when `values` is present, every element is a string.

On any violation it produces a 400 with a message identifying the offending
variable name and rule.

**Why not `@ValidateNested({ each: true }) + @Type(() => StateVarDto)`?**
That pairing reliably deep-validates arrays and fixed-shape nested objects, but
class-transformer does not transform the values of a dynamically-keyed
`Record<string, Dto>` into class instances, so the nested validators silently
do not fire. A purpose-built validator that iterates `Object.entries()` is the
robust, predictable choice for a map and lets us emit clear per-variable
messages. `StateVarDto` can remain as a type/contract; the decorator is the
enforcement.

**Consequence (intended):** Because the decorator validates the whole entry, a
malformed `type` is now also rejected — previously it was not. This is in line
with the guide and is a net improvement, not scope creep.

### 2. Translate E11000 into a 409 ConflictException

**Decision:** In `create()` and `update()`, wrap the persistence call that can
violate the `(campaignId, content.meta.hiddenId)` partial unique index. On a
caught MongoDB duplicate-key error (`error.code === 11000`), throw a NestJS
`ConflictException` with a message like
`hiddenId "<slug>" already exists in this campaign`.

**Why local handling over a global Mongo exception filter?** Only `hiddenId`
has a meaningful uniqueness contract here, and the message should name the
field and slug. A blanket 11000→409 filter would be less precise and could mask
other future unique-index semantics. Keep the translation where the context is.

**Update path nuance:** the catch must wrap the `findByIdAndUpdate` that writes
`content` (which contains `meta.hiddenId`). The conflicting slug for the message
comes from `dto.meta.hiddenId`.

### 3. `increment` default of 1 — verify and lock with a test

**Decision:** No production code change expected; `item.by ?? 1` already covers
both scopes. Add a regression test asserting that a mutation
`{ op: "increment", key: "local.x" }` with no `by` increments by exactly 1, and
the same for `global`.

### 4. Tolerate absent/partial state; keep stored `content.state` consistent

**Decision:** Confirm `projectState()` and `update()` never throw on absent
`state`, `state.local`, or `state.global`, and that missing scopes yield `{}`.
Normalize the stored `content.state` so a read/export of a stateless terminal
returns a stable shape rather than `undefined` (store `state` only when present,
or default to an empty object — pick one and apply consistently in
`contentWithoutUsers()`). Cover with tests for: no `state` key, `local`-only,
`global`-only.

## Risks / Trade-offs

- **[Custom validator diverges from `StateVarDto`]** → Keep the allowed `type`
  set defined in one place (reuse the union/const used by `StateVarDto`) so the
  decorator and the DTO type cannot drift.
- **[Newly-enforced `type` validation rejects previously-accepted input]** →
  This only affects malformed declarations that should never have been accepted;
  existing stored terminals are not re-validated. Acceptable and desirable.
- **[E11000 detection is driver-version sensitive]** → Match on the documented
  `code === 11000`; do not parse error message text.
- **[`content.state` normalization could change export round-trips]** → Choose
  the normalization that re-imports cleanly (an absent or empty `state` must
  both be accepted by item 4), and assert round-trip in a test.

## Migration Plan

No data migration. Changes are validation/error-handling only and do not alter
stored documents. Rollback is a straight revert; no state to unwind.

## Open Questions

- For item 4, prefer **omit `state` when absent** or **store `{}`**? Both
  satisfy the requirement; the tasks/spec will pick "store an object" for read
  consistency unless there's a reason to keep it absent.
