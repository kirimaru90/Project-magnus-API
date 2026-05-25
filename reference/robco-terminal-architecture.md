# RobCo Terminal Simulator — Server Architecture Design

## Overview

This document specifies the architecture for evolving the RobCo Terminal Simulator from a pure static site into a server-backed application supporting multiple campaigns, shared world state, and multi-user content authoring.

The system is composed of three logical components:

- **API** — the central source of truth; stores content, manages state, enforces authentication.
- **Backoffice** — an admin-facing web application for managing campaigns, terminals, users, and state.
- **Terminal** — the existing player-facing CRT terminal engine, extended to consume the API and react to state.

All three components communicate through the API. No component talks directly to the database. The Terminal and Backoffice are clients; the API is authoritative.

---

## Goals

- Support **multiple campaigns**, each with isolated content and state, as a top-level concept.
- Track **shared, persistent state** within a campaign: choices and actions in one terminal can affect content in another.
- Enable **non-technical content authoring** via a web-based backoffice — no manual JSON editing required for the common case.
- Provide **real authentication** for administrators and players (replacing the current client-side plaintext check).
- Keep **fictional credentials secret**: in-universe passwords used as narrative puzzles must not be visible in the browser before being solved.
- Preserve the **existing terminal aesthetic and engine** — the Fallout CRT experience does not change visually.
- Maintain **terminal content portability**: terminals can be exported and imported as JSON, including their state schema.
- Support **multi-user administration**: multiple admins can manage content concurrently.
- Allow **state reset operations** at variable, terminal, and campaign granularity, with defaults always derivable from the terminal content.
- Support **public campaigns** accessible to unauthenticated users, with login available as an optional action during campaign selection.

---

## Non-Goals

- **Per-player progress tracking.** Progress is campaign-wide, not per-player. The terminal does not "remember where you left off" for an individual user.
- **Real-time multiplayer.** Multiple players can be in the same campaign, but there is no simultaneous co-navigation, presence, or chat.
- **Replacing the terminal engine.** The Terminal remains a single-page vanilla JS application rendered in a CRT aesthetic. No framework rewrite.
- **English or other localizations.** The UI and content stay Italian.
- **A custom scripting language for content.** Authors define content through structured JSON and a visual editor — no embedded code execution, no expression evaluation engine beyond the declared condition syntax.
- **Cross-campaign state.** State is strictly scoped to a single campaign. Campaigns are independent universes.
- **Per-terminal versioning history.** Terminals are mutable records; older versions are not retained automatically.

---

## Nice to Haves

These are not part of the initial design but are valuable future directions:

- **Visual node graph editor** (Twine-style) for authoring branching narratives on a canvas.
- **Analytics**: which terminals are accessed most, which nodes are dead ends, distribution of choices.
- **Multiple admin roles**: separating "superadmin" (manages admins, all campaigns) from "campaign author" (manages content within assigned campaigns).
- **Version history for terminals**: snapshot every published change, ability to roll back.
- **Live preview during authoring**: render a terminal in a sidebar of the backoffice as the author edits it.
- **Backup & restore**: export an entire campaign (terminals + state + assignments) as a single bundle.
- **Auto-save drafts**: prevent loss of work during terminal editing.
- **Bulk operations**: import multiple terminals at once, copy a campaign as a template.
- **Audit log**: who changed what and when in the backoffice.

---

## General Architecture

```
┌─────────────────────────┐       ┌─────────────────────────┐
│      BACKOFFICE         │       │       TERMINAL          │
│    (admin web app)      │       │   (player-facing CRT)   │
│                         │       │                         │
│  - Campaigns            │       │  - Boot screen          │
│  - Terminals (CRUD)     │       │  - Campaign selection   │
│  - State viewer/editor  │       │  - Node rendering       │
│  - Users                │       │  - Choice navigation    │
│  - Import/export        │       │  - Input components     │
└────────────┬────────────┘       └────────────┬────────────┘
             │                                 │
             │           HTTP / JSON            │
             └────────────────┬────────────────┘
                              │
                  ┌───────────▼────────────┐
                  │         API            │
                  │                        │
                  │  - Authentication      │
                  │  - Authorization       │
                  │  - Campaign CRUD       │
                  │  - Terminal CRUD       │
                  │  - State read/mutate   │
                  │  - Fictional login     │
                  │  - User management     │
                  └───────────┬────────────┘
                              │
                  ┌───────────▼────────────┐
                  │       DATABASE         │
                  │                        │
                  │  campaigns             │
                  │  campaign_players      │
                  │  terminals             │
                  │  terminal_state        │
                  │  campaign_state        │
                  │  real_users            │
                  └────────────────────────┘
```

---

## Component: API

### Responsibilities

- Single authoritative source for all persistent data.
- Enforces authentication for all non-public endpoints.
- Serves public campaigns (active + `is_public`) to unauthenticated requests.
- Enforces authorization rules (admin vs player; campaign membership; public access).
- Validates content and state mutations before applying them.
- Serves content with sensitive fields (e.g., fictional passwords) stripped.
- Validates fictional login attempts server-side.

### Endpoint Surface (logical)

```
Authentication
  POST   /auth/login                    real user login
  POST   /auth/logout
  GET    /auth/me                       current session info

Campaigns
  GET    /campaigns                     list — public campaigns always included;
                                        assigned campaigns included if authenticated
  POST   /campaigns                     create                          [admin]
  GET    /campaigns/:id                 detail — accessible if public or assigned
  PUT    /campaigns/:id                 update                          [admin]
  DELETE /campaigns/:id                 delete                          [admin]
  POST   /campaigns/:id/activate        toggle active flag              [admin]

Campaign Members
  GET    /campaigns/:id/players                                         [admin]
  POST   /campaigns/:id/players         assign player                   [admin]
  DELETE /campaigns/:id/players/:uid    remove player                   [admin]

Campaign State (global scope)
  GET    /campaigns/:id/state           read all global vars
  POST   /campaigns/:id/state/mutate    apply mutation(s)
  POST   /campaigns/:id/state/reset     reset to defaults               [admin]
  POST   /campaigns/:id/state/:key/reset reset single var               [admin]

Terminals
  GET    /campaigns/:id/terminals       list in campaign
  POST   /campaigns/:id/terminals       create                          [admin]
  GET    /terminals/:id                 detail (content stripped)
  PUT    /terminals/:id                 update                          [admin]
  DELETE /terminals/:id                 delete                          [admin]
  POST   /terminals/:id/export          export full JSON                [admin]
  POST   /campaigns/:id/terminals/import import JSON                    [admin]

Terminal State (local scope)
  GET    /terminals/:id/state           read all local vars
  POST   /terminals/:id/state/mutate    apply mutation(s)
  POST   /terminals/:id/state/reset     reset to defaults               [admin]
  POST   /terminals/:id/state/:key/reset reset single var               [admin]

Terminal Playback
  GET    /terminals/:id/load            content + current state (stripped)
  POST   /terminals/:id/fictional-login validate fictional credentials

Users
  GET    /users                         list                            [admin]
  POST   /users                         create                          [admin]
  GET    /users/:id                                                     [admin]
  PUT    /users/:id                                                     [admin]
  DELETE /users/:id                                                     [admin]
```

Routes marked `[admin]` require an authenticated admin user. Campaign and terminal read/play routes are accessible to: authenticated players assigned to that campaign; authenticated admins; or unauthenticated requests when the campaign is active and `is_public`.

### Specs

- **Stateless interface**: every request carries authentication; no server-side session affinity beyond standard auth tokens/cookies.
- **JSON in, JSON out**: all payloads are JSON.
- **State mutations are atomic**: a single request applying multiple mutations either applies all or none.
- **Content stripping on load**: when content is delivered to the Terminal, fictional user passwords are never included in the response. Conditions and state structure may be exposed (these are narrative logic, not security).
- **Defaults preserved**: the terminal JSON content (stored as-is) is the source of truth for default state values. Reset operations always restore from this source.
- **Validation on import**: imported terminal JSON is validated against the schema before being persisted. Imports that declare global variables conflicting with existing campaign global variables follow first-declaration-wins semantics (existing values are preserved).
- **Public campaign access**: `GET /campaigns` and all read/play routes on active public campaigns do not require authentication. Unauthenticated requests receive only public campaigns.

### Constraints

- Must never deliver fictional credentials to any client.
- Must never accept state mutations that would create variables not declared in the terminal's state schema.
- Must reject state values that don't match the declared type (boolean, number, enum, string).
- Must enforce that local state mutations only target variables declared in the target terminal.
- Must enforce that global state mutations only target variables declared in some terminal of the target campaign.
- All write endpoints must be idempotent where possible and explicitly transactional where multiple rows are touched.
- Unauthenticated access is read-only on public campaigns; state mutation endpoints on public campaigns still require authentication (player or admin) to prevent anonymous state corruption.

---

## Component: Backoffice

### Responsibilities

- Provide a web UI for administrators to manage all data: campaigns, terminals, state, users.
- Translate user interactions into API calls; never bypass the API.
- Maintain a session-local "current campaign" context (workspace switcher).
- Generate valid terminal JSON from form-based input.
- Render the structured condition builder (and/or blocks) for node variants.

### Specs

**Authentication**
- Requires login. Only users with the `admin` role may access the backoffice.

**Campaign management**
- List all campaigns (active and inactive) visible to the admin.
- Create new campaigns; rename; delete (with confirmation).
- Toggle campaign active state on/off — controls whether players (and unauthenticated users) can access it.
- Toggle campaign `is_public` on/off — controls whether the campaign is accessible without login.
- Switch the "current campaign" UI context; all subsequent operations scope to it.
- View an inventory of all global state variables defined across the campaign's terminals, with their current values.

**Terminal management** (within current campaign)
- List terminals belonging to the campaign.
- Create a new terminal from scratch (visual editor) or by import.
- Edit terminal metadata, nodes, choices, state schema, fictional users.
- Delete a terminal (with confirmation), warning about loss of associated state.
- Export a terminal as JSON (full content, including state schema).
- Import a terminal from JSON file upload.
- Preview a terminal — open it in a sandboxed Terminal view with isolated state.

**Node & content editor**
- Form-based or visual editor for adding/editing nodes.
- Choice editor: link to target node, attach optional state mutations.
- State mutation editor: pick scope (local/global), variable, operation (set/increment/toggle), value.
- Condition editor: visual AND/OR blocks combining state predicates. Renders structured JSON, not expression strings.
- Input component editor: configure placeholder, target variable, branching rules based on input value.
- Markdown editor with live preview for node text.

**State management**
- View all local state for each terminal (with current and default values).
- View all global state for the campaign (with current and default values).
- Manually override any variable's value.
- Reset operations:
  - Reset a single variable to its default.
  - Reset all local state of a terminal to defaults.
  - Reset all global state of the campaign to defaults.
  - Reset the entire campaign (all local + all global).

**User management**
- List all real users (admins and players).
- Create users; assign role (admin or player); set initial password.
- Edit user details; reset passwords; delete.
- For player users, assign or unassign campaign memberships.
- A player can be assigned to multiple campaigns; a campaign can have multiple players.

### Constraints

- Must not store or display fictional credentials in plain text after creation. (Fictional passwords are stored hashed in the terminal content and only used server-side to validate login attempts.) — *open detail: see below*
- All destructive operations require explicit confirmation.
- The current campaign context is per-session UI state, not a persisted property of the admin user.
- The condition builder must produce JSON conforming to the canonical condition schema.
- The backoffice must validate terminal JSON before submitting via the import endpoint; the API performs final validation.

> **Note on fictional credentials**: there is a tension between authorability (admin needs to know/see the password to design the puzzle) and secrecy (the password must not leak to the player's browser). One workable model: the backoffice can display fictional passwords to the authoring admin in cleartext, but storage and transport between API and Terminal strip them. This trade-off should be revisited during implementation design.

---

## Component: Terminal

### Responsibilities

- Player-facing presentation of campaigns and terminals.
- Render nodes, evaluate conditions, manage navigation.
- Trigger state mutations via the API when authored content demands.
- Handle real player authentication as an optional flow initiated from the campaign selection screen.
- Validate fictional logins through the API.

### Specs

**Boot & campaign selection**

On load, the Terminal goes directly to the campaign selection screen — no upfront login required.

- **Unauthenticated state**: fetch and display all active public campaigns. Present a `[ Accedi ]` option alongside the campaign list using the same CRT aesthetic.
- **Authenticated state**: fetch and display all active public campaigns plus all campaigns the logged-in player is assigned to. Present a `[ Esci ]` (logout) option.
- If the player is authenticated and has no assigned campaigns, only public campaigns (if any) are shown.
- If there are no campaigns at all (public or assigned), display an appropriate "Nessuna campagna disponibile" state.
- If there is exactly one accessible campaign (after resolving public + assigned), enter it directly.
- If there are multiple accessible campaigns, present the selection screen.

**Login flow (from campaign selection)**

- The `[ Accedi ]` option presents the real-user login UI in the CRT aesthetic, inline on the campaign selection screen (or as a navigable sub-screen).
- On successful login, the campaign selection screen refreshes to include the player's assigned campaigns alongside any public ones.
- On failed login, an error is shown and the player remains on the campaign selection screen.
- A logged-in player can log out via `[ Esci ]`; this returns them to the unauthenticated campaign selection view (public campaigns remain visible).

**Campaign view**
- Fetch the list of terminals in the selected campaign from the API.
- Display the terminal selection screen (replacing the current `manifest.json` flow). Public/hidden distinction is preserved.
- Hidden terminal access by ID is validated server-side; the client never receives hidden terminal metadata until the ID is correctly entered.

**Terminal playback**
- On terminal load, fetch the terminal's content structure and current campaign state (both local and global) from the API.
- Always start from the `start` node — no resume.
- Render nodes with conditional variants evaluated against current state (client-side evaluation against the state snapshot).
- For each node entered, if `on_enter` mutations exist, send them to the API before/after rendering and refresh local state accordingly.
- For each choice taken, if `set` mutations exist, send them to the API before navigating.
- For input components, send the typed value as a state mutation, then evaluate branches against the updated state to determine the target node.

**Fictional login flow**
- When a node or terminal declares a `login` block, present the fictional login UI as today.
- Submit credentials to the API; the API validates against the stored content. The credentials are never present in the data the client received.
- On success, the API returns access to the gated content.
- Once a fictional user is authenticated within a session, treat subsequent gated nodes accessible for that user as already unlocked (in-session; not persisted).

**Aesthetic preservation**
- All visual elements (CRT phosphor, scan lines, typewriter effect, sound effects, keyboard navigation, PWA support) remain unchanged.
- The login sub-screen and campaign selection screen adopt the same aesthetic.

### Constraints

- Cannot read or write state directly — all state operations go through the API.
- Cannot modify variables not declared in the loaded terminal's state schema.
- Must not display fictional credentials at any time (they are never delivered).
- Must not cache content between sessions in a way that could leak unlocked-only data to an unauthenticated user. (Service worker caching strategies must respect authentication state; public campaign content may be cached, authenticated-only content must not be.)
- State evaluation is best-effort client-side; the API remains authoritative. If the API rejects a mutation, the Terminal must refresh state and re-render.
- State mutations initiated from within a public campaign by an unauthenticated user require the API to accept or reject them per its own policy (see API constraints). The Terminal must handle rejection gracefully.

---

## Data Model

### Entities

```
campaigns
  id              identifier
  name            human-readable label
  is_active       boolean — controls player and public access
  is_public       boolean — when true, accessible without login (if also active)

campaign_players                  (many-to-many junction)
  campaign_id
  player_id (→ real_users.id)
  joined_at

real_users
  id
  username
  password_hash
  role            'admin' | 'player'

terminals
  id
  campaign_id     (→ campaigns.id)
  title
  content_json    full terminal content including:
                    - meta
                    - state schema declaration (local + global)
                    - fictional users (with hashed passwords)
                    - nodes (text, choices, on_enter, variants, components)

terminal_state                    (local scope, per-terminal)
  terminal_id
  key
  type            boolean | number | enum | string
  value           current value
  default_value   default value (mirrored from content_json on import)

campaign_state                    (global scope, per-campaign)
  campaign_id
  key
  type
  value
  default_value
```

### State Scope Rules

- A terminal's `state.local` declarations populate `terminal_state` on import. Local state is owned by that terminal only.
- A terminal's `state.global` declarations populate `campaign_state` on import — but only if the variable does not already exist in the campaign. First declaration wins; subsequent imports preserve existing values.
- A variable name is unique within its scope. `local.foo` and `global.foo` are different variables.

### Mutation Triggers

State is mutated only by:

1. A node's `on_enter` block, applied when the player navigates to that node.
2. A choice's `set` block, applied when the player selects that choice.
3. An input component's submission, which stores the typed value into a state variable.

### Reset Operations

Reset always restores `default_value` from the row. Since `default_value` is mirrored from the terminal JSON at import time and never modified by play, the original author's defaults are preserved regardless of how much play has occurred.

---

## Terminal Content Schema (informal)

```json
{
  "meta": {
    "title": "Super-Duper Mart - Terminale Amministrativo",
    "public": true,
    "id": "super-duper-admin"
  },

  "state": {
    "local": {
      "bunker_code_seen": { "type": "boolean", "default": false },
      "access_count":     { "type": "number",  "default": 0 },
      "sullivan_mood":    { "type": "enum", "values": ["calm","paranoid","panicked"], "default": "calm" }
    },
    "global": {
      "omega_activated":  { "type": "boolean", "default": false }
    }
  },

  "login": {
    "users": [
      { "username": "Re_Del_Cram", "password": "<stored hashed>" }
    ]
  },

  "nodes": {
    "start": {
      "text": "...",
      "on_enter": [
        { "key": "local.access_count", "op": "increment", "by": 1 }
      ],
      "choices": [
        {
          "label": "[ Apri bunker ]",
          "target": "bunker_open",
          "when": {
            "and": [
              { "key": "local.bunker_code_seen", "eq": true },
              { "key": "global.omega_activated", "eq": false }
            ]
          },
          "set": [
            { "key": "global.omega_activated", "value": true }
          ]
        }
      ]
    },

    "porta_bunker": {
      "variants": [
        {
          "when": { "key": "local.bunker_code_seen", "eq": true },
          "text": "Conosci il codice: **58874645**.",
          "choices": [{ "label": "[ Entra ]", "target": "bunker_interno" }]
        },
        {
          "default": true,
          "text": "La porta è sigillata.",
          "choices": []
        }
      ]
    },

    "inserisci_codice": {
      "text": "Inserire codice di accesso:",
      "components": [
        {
          "type": "input",
          "placeholder": "CODICE...",
          "set": "local.entered_code",
          "branches": [
            { "when": { "key": "local.entered_code", "eq": "58874645" }, "target": "bunker_aperto" },
            { "default": true, "target": "codice_errato" }
          ]
        }
      ]
    }
  }
}
```

### Condition Syntax

Conditions are structured JSON, not expression strings. Operators:

- Leaf predicate: `{ "key": "scope.var", "eq": value }` (also `neq`, `gt`, `lt`, `gte`, `lte`, `in`)
- Combinator: `{ "and": [predicate, ...] }` and `{ "or": [predicate, ...] }`
- Nesting is permitted.
- `{ "default": true }` marks the fallback variant when no other variant matches.

---

## Cross-Cutting Concerns

### Authentication

- Two real roles: `admin` and `player`. Roles are mutually exclusive.
- Admins access the backoffice; players access the Terminal.
- Unauthenticated users may access the Terminal in a restricted mode: only active public campaigns are visible and playable.
- Sessions are managed by the API (mechanism unspecified — could be JWT, opaque tokens, signed cookies, etc.).

### Authorization

Access rules by actor:

| Actor | Visible campaigns | Can play | Can mutate state |
|---|---|---|---|
| Admin | All (active + inactive) | Any | Any |
| Authenticated player | Active public + assigned active | Any visible | Any visible |
| Unauthenticated | Active public only | Active public | TBD — see open points |

- Inactive campaigns are visible to admins but not to players or unauthenticated users.
- A player attempting to access content outside their assigned campaigns (and that is not public) receives a 403.

### State Consistency

- The API is the single source of truth for state values.
- Client-side state evaluation is permitted for rendering but is best-effort.
- Mutations must be applied via the API; the client refreshes local state from the API after each successful mutation.
- If a state mutation conflicts with another (e.g., concurrent admins editing the same variable), the API resolves with last-write-wins unless a more nuanced policy is added later.

### Import/Export Format

- Export produces a self-contained JSON document conforming to the schema above.
- Import accepts any JSON document conforming to the schema.
- Imports never overwrite existing terminals; they always create new ones.
- Global state variables follow first-declaration-wins on import.

---

## Open Points (to resolve during implementation design)

- Exact authentication mechanism (JWT vs session cookies).
- Whether fictional user passwords should be hashed in storage or remain reversible (relates to admin authorability vs. backend leak resistance).
- Backwards compatibility with the current `dati/*.json` flat format: migration tool to convert legacy terminals into the new schema with empty state declarations.
- PWA / service worker behavior when content is now gated and dynamic — caching strategy must distinguish public (cacheable) from authenticated-only (non-cacheable) content.
- Concurrency: behavior when two admins edit the same terminal simultaneously.
- **State mutations from unauthenticated users in public campaigns**: whether to allow, require a session cookie for anonymous continuity within a visit, or block entirely. If allowed, consider the risk of anonymous users corrupting shared campaign state.
