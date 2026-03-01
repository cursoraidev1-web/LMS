import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { getRedis } from '../db/redis';

const router = Router();

/** Liveness: is the process up? */
router.get('/live', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

/** Readiness: can we serve traffic? (DB + Redis) */
router.get('/ready', async (_req: Request, res: Response) => {
  const checks: Record<string, string> = {};
  try {
    if (mongoose.connection.readyState !== 1) checks.mongodb = 'disconnected';
  } catch {
    checks.mongodb = 'error';
  }
  try {
    const redis = getRedis();
    await redis.ping();
  } catch {
    checks.redis = 'error';
  }
  const ok = Object.keys(checks).length === 0;
  res.status(ok ? 200 : 503).json({
    status: ok ? 'ok' : 'degraded',
    checks: Object.keys(checks).length ? checks : undefined,
  });
});

export default router;
