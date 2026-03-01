# Deploying to Render

The TypeScript build requires **devDependencies** (e.g. `@types/node`, `@types/express`) to compile. Render often runs `npm install` with `NODE_ENV=production`, which skips devDependencies and causes the build to fail.

## Build command

In your Render service **Build Command**, use either:

- **Recommended:** `npm run build:render`  
  This runs `npm install --include=dev` then `npm run build`, so type definitions are installed and `tsc` succeeds.

- Or set the build command to:  
  `npm install --include=dev && npm run build`

**Start Command:** `npm start` (runs `node dist/server.js`).

## Environment

Set all variables from `.env.example` in the Render dashboard (e.g. `MONGODB_URI`, `REDIS_URI`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, etc.).
