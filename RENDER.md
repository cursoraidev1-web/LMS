# Deploying to Render

Type definitions and TypeScript are in **dependencies**, so a standard production install (`npm install && npm run build`) works.

## Build command

Use the default:

- **Build Command:** `npm install && npm run build`
- **Start Command:** `npm start` (runs `node dist/server.js`)

Test files are excluded from the build, so you don't need Vitest/Supertest on Render.

## Environment

Set all variables from `.env.example` in the Render dashboard (e.g. `MONGODB_URI`, `REDIS_URI`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, etc.).
