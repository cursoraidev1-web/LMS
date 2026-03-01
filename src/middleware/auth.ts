import { Request, Response, NextFunction } from 'express';
import * as jwt from 'jsonwebtoken';
import { config } from '../config';
import { AppError } from './errorHandler';
import { getRedis } from '../db/redis';

export type Role = 'student' | 'admin' | 'super_admin';

export interface JwtPayload {
  sub: string;
  role: Role;
  organizationId?: string;
  type: 'access' | 'refresh';
  iat?: number;
  exp?: number;
}

export function authMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    next(new AppError(401, 'Authentication required'));
    return;
  }

  try {
    const decoded = jwt.verify(token, config.JWT_ACCESS_SECRET) as JwtPayload & { sub: string };
    if (decoded.type !== 'access') {
      next(new AppError(401, 'Invalid token type'));
      return;
    }
    req.user = {
      id: decoded.sub,
      sub: decoded.sub,
      role: decoded.role,
      organizationId: decoded.organizationId,
      type: decoded.type,
    };
    next();
  } catch {
    next(new AppError(401, 'Invalid or expired token'));
  }
}

/** Require one of the given roles */
export function requireRoles(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new AppError(401, 'Authentication required'));
      return;
    }
    if (!roles.includes(req.user.role)) {
      next(new AppError(403, 'Insufficient permissions'));
      return;
    }
    next();
  };
}

/** Resolve tenant from header x-organization-id; attach to request. Super Admin can omit. */
export function tenantMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const orgId = req.headers['x-organization-id'] as string | undefined;
  if (req.user?.role === 'super_admin') {
    req.organizationId = orgId ?? null;
    next();
    return;
  }
  if (!orgId && req.user?.organizationId) {
    req.organizationId = req.user.organizationId;
    next();
    return;
  }
  if (!orgId) {
    next(new AppError(400, 'x-organization-id required'));
    return;
  }
  if (req.user?.organizationId && req.user.organizationId !== orgId) {
    next(new AppError(403, 'Access denied for this organization'));
    return;
  }
  req.organizationId = orgId;
  next();
}

const REFRESH_PREFIX = 'refresh:';

export async function invalidateRefreshToken(userId: string): Promise<void> {
  const redis = getRedis();
  await redis.del(REFRESH_PREFIX + userId);
}

export async function storeRefreshToken(userId: string, tokenId: string, ttlSeconds: number): Promise<void> {
  const redis = getRedis();
  await redis.setex(REFRESH_PREFIX + userId, ttlSeconds, tokenId);
}

export async function validateRefreshToken(userId: string, tokenId: string): Promise<boolean> {
  const redis = getRedis();
  const stored = await redis.get(REFRESH_PREFIX + userId);
  return stored === tokenId;
}

export function signAccessToken(payload: Omit<JwtPayload, 'type' | 'iat' | 'exp'>): string {
  return jwt.sign(
    { ...payload, type: 'access' },
    config.JWT_ACCESS_SECRET,
    { expiresIn: config.JWT_ACCESS_EXPIRES_IN } as jwt.SignOptions
  );
}

export function signRefreshToken(payload: Omit<JwtPayload, 'type' | 'iat' | 'exp'>): string {
  return jwt.sign(
    { ...payload, type: 'refresh' },
    config.JWT_REFRESH_SECRET,
    { expiresIn: config.JWT_REFRESH_EXPIRES_IN } as jwt.SignOptions
  );
}
