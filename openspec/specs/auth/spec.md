# auth Specification

## Purpose

Real-user login/logout, JWT issuance and verification, current-session inspection, and role-based access primitives for the API.

## Requirements

### Requirement: Real-user login issues a JWT
The API SHALL accept `POST /auth/login` with a JSON body `{ username, password }`. On valid credentials it SHALL return a JSON Web Token signed with HS256 and the server-side `JWT_SECRET`, containing claims `sub` (user id), `role` (`admin` or `player`), `iat`, and `exp` (24 hours after issuance). On invalid credentials it SHALL return HTTP 401 with no detail distinguishing unknown user from wrong password.

#### Scenario: Successful admin login
- **WHEN** a request to `POST /auth/login` is made with the correct username and password for a user with role `admin`
- **THEN** the response is HTTP 200 with body `{ accessToken: <string>, role: "admin", expiresIn: 86400 }`
- **AND** the JWT decodes to claims that include `sub`, `role: "admin"`, and an `exp` 24 hours in the future

#### Scenario: Successful player login
- **WHEN** a request to `POST /auth/login` is made with the correct credentials for a user with role `player`
- **THEN** the response is HTTP 200 and the returned JWT has `role: "player"`

#### Scenario: Invalid password
- **WHEN** a request to `POST /auth/login` is made with a valid username but an incorrect password
- **THEN** the response is HTTP 401 with a generic error message
- **AND** the response body does not reveal whether the username exists

#### Scenario: Unknown username
- **WHEN** a request to `POST /auth/login` is made with a username that does not exist
- **THEN** the response is HTTP 401 with the same generic error message used for invalid passwords

### Requirement: Logout is a client-side concern but exposed for symmetry
The API SHALL accept `POST /auth/logout` and respond with HTTP 204. Because tokens are stateless, the endpoint performs no server-side action; clients are responsible for discarding their token.

#### Scenario: Logout call succeeds without a token
- **WHEN** `POST /auth/logout` is called without any Authorization header
- **THEN** the response is HTTP 204

#### Scenario: Logout call succeeds with a token
- **WHEN** `POST /auth/logout` is called with a valid bearer token
- **THEN** the response is HTTP 204 and the token remains technically valid until its `exp`

### Requirement: Current session inspection
The API SHALL accept `GET /auth/me` with a bearer token and return the authenticated user's profile.

#### Scenario: Authenticated me call
- **WHEN** `GET /auth/me` is called with a valid bearer token for user `u1`
- **THEN** the response is HTTP 200 with body `{ id, username, role }` for user `u1`

#### Scenario: Unauthenticated me call
- **WHEN** `GET /auth/me` is called without a bearer token
- **THEN** the response is HTTP 401

#### Scenario: Expired token
- **WHEN** `GET /auth/me` is called with a token whose `exp` is in the past
- **THEN** the response is HTTP 401

### Requirement: JWT verification on protected routes
The API SHALL provide reusable authentication primitives (Guards) that protected routes can apply: one that requires a valid JWT (rejecting with 401 otherwise) and one that only requires admin role (rejecting with 403 if the token is valid but the role is `player`).

#### Scenario: Missing token on a protected route
- **WHEN** a request without an Authorization header is made to a route that requires authentication
- **THEN** the response is HTTP 401

#### Scenario: Player accessing admin route
- **WHEN** a request with a valid player-role token is made to a route that requires admin
- **THEN** the response is HTTP 403

#### Scenario: Tampered token
- **WHEN** a request is made with a JWT whose signature does not verify against `JWT_SECRET`
- **THEN** the response is HTTP 401

### Requirement: Bcrypt password storage
The API SHALL store real-user passwords hashed with bcrypt at cost factor 12 or higher and SHALL NOT store, log, or return plaintext passwords from any endpoint.

#### Scenario: Password is never returned
- **WHEN** any endpoint returns a user object
- **THEN** the response body contains no `password`, `passwordHash`, or equivalent field

#### Scenario: Hash format
- **WHEN** a user is created via the user-management API
- **THEN** the persisted `passwordHash` matches the bcrypt format `$2[aby]?$<cost>$...`
