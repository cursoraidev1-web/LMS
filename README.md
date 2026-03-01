# LMS CBT Backend

Production-ready, fast, and secure API for the Computer-Based Testing (CBT) system. Multi-tenant, JWT auth, Redis-backed sessions and rate limiting.

## Stack

- **Runtime:** Node.js 20+
- **Framework:** Express 4 (TypeScript)
- **DB:** MongoDB (Mongoose)
- **Cache/Sessions:** Redis (ioredis)
- **Auth:** JWT (access + refresh), bcrypt (cost 12)
- **Validation:** Zod
- **Logging:** Pino

## Security

- **Helmet** – secure headers (CSP, HSTS, etc.)
- **CORS** – configurable allowed origins
- **Rate limiting** – per-IP, configurable window/max
- **Mongo sanitize** – strips `$` and `.` to prevent NoSQL injection
- **HPP** – HTTP Parameter Pollution protection
- **JWT** – short-lived access tokens, refresh tokens stored in Redis (revocable)
- **Tenant isolation** – `x-organization-id` + role checks; all data scoped by organization

## Quick start

1. **Env**

   ```bash
   cp .env.example .env
   # Set MONGODB_URI, REDIS_URI, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET (min 32 chars each)
   ```

2. **Install & run**

   ```bash
   npm install
   npm run dev
   ```

   API base: `http://localhost:4000/api/v1`  
   **API docs (Swagger):** `http://localhost:4000/api-docs` — OpenAPI spec at `GET /api/v1/openapi.yaml`  
   Health: `http://localhost:4000/health` (live), `http://localhost:4000/api/v1/health/ready` (ready with DB/Redis).

3. **Production**

   ```bash
   npm run build
   NODE_ENV=production npm start
   ```

## Project structure

```
src/
├── config/       # Env validation (Zod)
├── db/           # MongoDB + Redis connection
├── middleware/   # security, auth, tenant, errorHandler, requestLogger, validate
├── routes/       # health, API v1
├── types/        # Express Request extensions
├── utils/        # logger, validate helper
├── app.ts        # Express app + middleware order
└── server.ts     # Start server, graceful shutdown
```

## Health checks

- `GET /health` – liveness (process up).
- `GET /api/v1/health/live` – same.
- `GET /api/v1/health/ready` – readiness (MongoDB + Redis). Returns 503 if either is down.

## Auth & multi-tenant

- **Access token:** `Authorization: Bearer <access_token>`
- **Tenant:** `x-organization-id: <organizationId>` (required for admin/student; optional for super_admin)
- Use `authMiddleware`, `requireRoles(['admin','super_admin'])`, `tenantMiddleware` on protected routes. All tenant-scoped queries must filter by `organizationId` (from `req.organizationId`) unless the user is `super_admin`.

## Scripts

| Script   | Description                |
|----------|----------------------------|
| `npm run dev`   | Run with tsx watch        |
| `npm run build` | Compile to `dist/`        |
| `npm start`     | Run `dist/server.js`      |
| `npm run lint`  | ESLint                    |
| `npm test`      | Vitest                    |

## Env (see `.env.example`)

Required: `MONGODB_URI`, `REDIS_URI`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`.  
Optional: `PORT`, `API_PREFIX`, `BCRYPT_ROUNDS`, `RATE_LIMIT_*`, `CORS_ORIGINS`, `LOG_LEVEL`.
