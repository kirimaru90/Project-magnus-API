# State Schema Admin — Backoffice Integration Guide

This document describes the two schema-admin endpoints and how the backoffice should call and display them.

---

## Endpoints

| Method | Path | Auth |
|--------|------|------|
| `PATCH` | `/terminals/:id/state/schema` | Admin JWT |
| `PATCH` | `/campaigns/:id/state/schema` | Admin JWT |

Both require a valid admin Bearer token in the `Authorization` header.

---

## Request body

```json
{
  "ops": [
    { "action": "add",    "name": "<varName>", "entry": { "type": "...", "default": ..., "values"?: [...] }, "value"?: ... },
    { "action": "update", "name": "<currentName>", "rename"?: "<newName>", "entry": { ... }, "value"?: ... },
    { "action": "delete", "name": "<varName>" }
  ]
}
```

### Entry shape

| Field | Required | Notes |
|-------|----------|-------|
| `type` | yes | `boolean`, `number`, `string`, `enum` |
| `default` | yes | Must match `type`. For enum, must be one of `values`. |
| `values` | enum only | Non-empty `string[]`. Ignored for non-enum types. |

### Op rules

- **`ops` must be non-empty** — empty array → 400.
- **Each variable name appears at most once** across all `name` and `rename` fields — duplicates → 400.
- **`add`** on an existing variable → 400. Use `update` to modify.
- **`update`/`delete`** on a non-existent variable → 404.
- **Rename target collision**: if `rename` target already exists in current state (or is the rename target of another op) → 409.
- **`value` omitted** on `add` / `update` → variable value is set/reset to `entry.default`. Pre-populate `value` from current state if you want to preserve it.

---

## Payload examples

### Add a new variable

```json
{
  "ops": [
    {
      "action": "add",
      "name": "siteOpen",
      "entry": { "type": "boolean", "default": false }
    }
  ]
}
```

### Update with rename

```json
{
  "ops": [
    {
      "action": "update",
      "name": "mode",
      "rename": "phase",
      "entry": { "type": "enum", "values": ["idle", "active"], "default": "idle" },
      "value": "idle"
    }
  ]
}
```

`value` is explicitly provided to preserve the current value after the type/rename change. If omitted, the variable resets to `entry.default`.

### Delete a variable

```json
{
  "ops": [
    { "action": "delete", "name": "legacy" }
  ]
}
```

### Mixed in one request

```json
{
  "ops": [
    { "action": "add",    "name": "alarm",  "entry": { "type": "boolean", "default": false } },
    { "action": "update", "name": "score",  "entry": { "type": "number",  "default": 0     }, "value": 42 },
    { "action": "delete", "name": "obsolete" }
  ]
}
```

---

## Success response (HTTP 200)

```json
{
  "state": {
    "siteOpen": false,
    "phase": "idle",
    "alarm": true
  }
}
```

The `state` map is the flat post-update snapshot (`{ varName: currentValue, ... }`).

---

## Error responses

### 400 — Validation / structural error

```json
{ "statusCode": 400, "message": "ops must be a non-empty array" }
```

Common causes: empty `ops`, duplicate names, `add` on existing variable, invalid `default`/`value` for type.

### 404 — Variable not found

```json
{ "statusCode": 404, "message": "Variable \"legacy\" not found" }
```

Returned when an `update` or `delete` targets a name that doesn't exist in the current state.

### 409 — Conflict (campaign endpoint only)

Returned when a **`delete`** op names a variable that at least one terminal references at `content.state.global.<name>`, or when a **`rename`** op would collide with an existing key on a referencing terminal.

```json
{
  "error": "Cannot delete referenced variables",
  "conflicts": [
    {
      "variable": "score",
      "referencedBy": [
        { "id": "64abc...", "title": "Terminal Alpha" },
        { "id": "64def...", "title": "Terminal Beta" }
      ]
    }
  ]
}
```

**Recommended UX:**
- Parse `conflicts` and display a blocking modal listing the `referencedBy` terminals as clickable links (link target: `GET /terminals/:id`).
- Do not allow the admin to proceed with the delete until each referencing terminal has been updated to remove or replace the reference.

Rename collision 409:

```json
{
  "error": "Rename target already exists on referencing terminals",
  "conflicts": [
    {
      "variable": "mode → phase",
      "referencedBy": [
        { "id": "64abc...", "title": "Terminal Alpha" }
      ]
    }
  ]
}
```

The offending terminal(s) already have both the `from` and `to` keys set at `content.state.global`. The admin must resolve the collision in those terminals first.

---

## The `content.state.global.<key>` reference convention

Terminals reference campaign-level (global) variables by placing a value at the path:

```
terminal.content.state.global.<varKey>
```

This is the only structured reference path the server scans. Free-text references (e.g., `{{global.x}}` in node text) are **not** scanned.

### Example terminal content fragment

```json
{
  "state": {
    "global": {
      "phase": "idle",
      "score": 0
    }
  }
}
```

If `phase` is renamed to `stage` via the campaign schema endpoint, the server rewrites this to:

```json
{
  "state": {
    "global": {
      "stage": "idle",
      "score": 0
    }
  }
}
```

---

## Apply order and partial-failure on rename

For rename ops on the **campaign endpoint**, the server applies changes in this order:

1. **Terminal rewrites first**: `updateMany` with `$rename` on all terminals in the campaign that reference the old key.
2. **Campaign write last**: single `$set` replacing the whole `state` map on the campaign document.

This order ensures that if step 1 partially completes and step 2 never runs, terminals reference the new key while the campaign still has the old key intact — the system is stale but readable.

**On partial failure:** the admin can retry the same PATCH request. The `$rename` on terminals that already have the new key (and not the old key) is a no-op; the campaign write will succeed on retry.

**Atomicity note:** There is no Mongo transaction. In practice the write rate on this admin path is very low and last-write-wins is acceptable. Optimistic locking (ETag / `If-Match`) is deferred to a future version.

---

## Recommended UX

| Action | UX guidance |
|--------|-------------|
| **Add** | Show empty form for new variable. Display current state to give context. |
| **Update** | Pre-populate `value` from current document so the admin sees what will change. |
| **Delete** | Show confirmation. If 409 is returned, surface the `referencedBy` terminal list as clickable links so the admin can fix each one first. |
| **Rename** | Require explicit confirm: "This will rewrite N terminals." On 409, surface the colliding terminals. |
| **In-flight** | Disable the form while the PATCH is in-flight to prevent concurrent edits overwriting each other. |
