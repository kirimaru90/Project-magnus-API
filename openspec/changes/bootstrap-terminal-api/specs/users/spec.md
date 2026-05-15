## ADDED Requirements

### Requirement: Admin can list real users
The API SHALL expose `GET /users` returning all real users. The route SHALL be restricted to admin role. Response items SHALL include `id`, `username`, `role`, and `createdAt`, and SHALL NOT include any password material.

#### Scenario: Admin lists users
- **WHEN** an admin calls `GET /users`
- **THEN** the response is HTTP 200 with an array of user summaries containing `id`, `username`, `role`, `createdAt`

#### Scenario: Player cannot list users
- **WHEN** a player-role token is used to call `GET /users`
- **THEN** the response is HTTP 403

#### Scenario: Anonymous cannot list users
- **WHEN** `GET /users` is called without a token
- **THEN** the response is HTTP 401

### Requirement: Admin can create users
The API SHALL expose `POST /users` accepting `{ username, password, role }` where `role` is `admin` or `player`. On success the response SHALL be HTTP 201 with the created user summary (no password fields). Usernames SHALL be unique; a duplicate request SHALL return HTTP 409.

#### Scenario: Admin creates a player
- **WHEN** an admin calls `POST /users` with body `{ username: "alice", password: "p@ssword1", role: "player" }`
- **THEN** the response is HTTP 201 with `{ id, username: "alice", role: "player", createdAt }`
- **AND** the persisted record stores `passwordHash` as a bcrypt hash

#### Scenario: Duplicate username
- **WHEN** an admin tries to create a user whose `username` already exists
- **THEN** the response is HTTP 409

#### Scenario: Invalid role
- **WHEN** an admin sends `POST /users` with `role: "superadmin"`
- **THEN** the response is HTTP 400

### Requirement: Admin can read, update, and delete users
The API SHALL expose `GET /users/:id`, `PUT /users/:id`, and `DELETE /users/:id`, all admin-only. `PUT` SHALL accept any subset of `{ username, password, role }`. When `password` is included, it SHALL be re-hashed via bcrypt before storage.

#### Scenario: Admin reads a user
- **WHEN** an admin calls `GET /users/:id` for an existing user
- **THEN** the response is HTTP 200 with `{ id, username, role, createdAt }`

#### Scenario: Admin updates a user's role
- **WHEN** an admin calls `PUT /users/:id` with body `{ role: "admin" }`
- **THEN** the response is HTTP 200 and subsequent `GET /users/:id` reflects the new role

#### Scenario: Admin resets a user's password
- **WHEN** an admin calls `PUT /users/:id` with body `{ password: "newPass!" }`
- **THEN** the response is HTTP 200
- **AND** the persisted `passwordHash` matches the new password under bcrypt
- **AND** a subsequent `POST /auth/login` with the new password succeeds

#### Scenario: Admin deletes a user
- **WHEN** an admin calls `DELETE /users/:id`
- **THEN** the response is HTTP 204
- **AND** the user is removed from any `campaigns.players` arrays

#### Scenario: Reading a missing user
- **WHEN** an admin calls `GET /users/:id` for an id that does not exist
- **THEN** the response is HTTP 404

### Requirement: Admin cannot delete themselves
The API SHALL reject any `DELETE /users/:id` request where `:id` equals the authenticated caller's id, returning HTTP 409.

#### Scenario: Self-deletion blocked
- **WHEN** an admin with id `admin-1` calls `DELETE /users/admin-1`
- **THEN** the response is HTTP 409 and the user is not deleted
