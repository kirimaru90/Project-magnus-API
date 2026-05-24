# RobCo Terminal API

NestJS + Fastify + MongoDB API server for the RobCo Terminal Simulator.

## Environment Variables

Copy `.env.example` to `.env` and fill in the values:

| Variable | Description | Default |
|---|---|---|
| `MONGO_URL` | MongoDB connection string | `mongodb://localhost:27017/robco` |
| `JWT_SECRET` | JWT signing secret — rotate to invalidate all sessions | `change-me-in-production` |
| `PORT` | HTTP listen port | `3000` |
| `CORS_ALLOWED_ORIGINS` | Comma-separated allowed origins (empty = `*`) | `` |
| `BOOTSTRAP_ADMIN_USERNAME` | Username for the initial admin (bootstrap script only) | — |
| `BOOTSTRAP_ADMIN_PASSWORD` | Password for the initial admin (bootstrap script only) | — |

## Bootstrapping the First Admin

Run once before first use:

```bash
cp .env.example .env
# edit .env, set BOOTSTRAP_ADMIN_USERNAME and BOOTSTRAP_ADMIN_PASSWORD
npm run bootstrap:admin
```

The script is idempotent — it does nothing if the user already exists.

## Running

```bash
# Development (watch mode)
npm run start:dev

# Production
npm run build
npm run start:prod

# Docker Compose (API + MongoDB)
docker compose up --build
```

## API Documentation

Swagger UI is available at `http://localhost:3000/docs` when the server is running.

## Running Tests

```bash
# Unit tests
npm test

# End-to-end tests (uses mongodb-memory-server, no external DB needed)
npm run test:e2e
```

## State Mutation Policy

Public campaigns (where `isActive == true` and `isPublic == true`) accept state mutations from **unauthenticated callers**. This is a product decision — it means anyone can affect shared campaign state. Operators can disable this by setting `isPublic = false` on the campaign at any time.

## Token Management

Authentication tokens are stateless JWTs (24h expiry). There is no per-token revocation. To invalidate all active sessions, rotate `JWT_SECRET` and restart the server.
