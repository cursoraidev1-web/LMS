import { Router, Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import { z } from 'zod';
import { config } from '../config';
import { AppError } from '../middleware/errorHandler';
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import {
  signAccessToken,
  signRefreshToken,
  storeRefreshToken,
  validateRefreshToken,
  invalidateRefreshToken,
  authMiddleware,
  requireRoles,
  type JwtPayload,
} from '../middleware/auth';
import { validate } from '../utils/validate';
import { User } from '../models/User';
import { Organization } from '../models/Organization';
import { getRedis } from '../db/redis';
import { sendPasswordResetEmail } from '../services/email';

/** Resolve organization code (slug) or ID to organization _id string. Accepts e.g. "platform" or full MongoDB ID. */
async function resolveOrgId(value: string): Promise<string | null> {
  const v = (value || '').trim();
  if (!v) return null;
  if (/^[a-fA-F0-9]{24}$/.test(v)) {
    const org = await Organization.findById(v).lean();
    return org ? org._id.toString() : null;
  }
  const org = await Organization.findOne({ slug: v.toLowerCase() }).lean();
  return org ? org._id.toString() : null;
}

const SERVICE_UNAVAILABLE = 'Service temporarily unavailable. Please try again later.';

function isDbOrConnectionError(e: unknown): boolean {
  if (e instanceof mongoose.Error) return true;
  if (e && typeof e === 'object' && 'name' in e) {
    const name = String((e as { name: string }).name);
    if (/Mongo|Mongoose/i.test(name)) return true;
  }
  const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message: string }).message) : '';
  if (
    /buffering timed out|connection|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|MongoNetworkError|MongoTimeoutError/i.test(msg)
  ) {
    return true;
  }
  return false;
}

const router = Router();

const registerBody = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(1),
  role: z.enum(['student', 'admin']),
  organizationId: z.string().min(1, 'organizationId required'),
});
const loginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  organizationId: z.string().min(1),
});
const refreshBody = z.object({ refreshToken: z.string().min(1) });
const forgotBody = z.object({ email: z.string().email(), organizationId: z.string().min(1) });
const resetBody = z.object({ token: z.string().min(1), newPassword: z.string().min(8, 'Password must be at least 8 characters') });

const RESET_PREFIX = 'reset:';
const TEMP_2FA_PREFIX = 'temp2fa:';
const RESET_TTL = 3600;
const TEMP_2FA_TTL = 300; // 5 min

async function setResetToken(token: string, userId: string): Promise<void> {
  await getRedis().setex(RESET_PREFIX + token, RESET_TTL, userId);
}

async function consumeResetToken(token: string): Promise<string | null> {
  const key = RESET_PREFIX + token;
  const userId = await getRedis().get(key);
  if (!userId) return null;
  await getRedis().del(key);
  return userId;
}

async function setTemp2FAToken(token: string, userId: string): Promise<void> {
  await getRedis().setex(TEMP_2FA_PREFIX + token, TEMP_2FA_TTL, userId);
}

async function consumeTemp2FAToken(token: string): Promise<string | null> {
  const key = TEMP_2FA_PREFIX + token;
  const userId = await getRedis().get(key);
  if (!userId) return null;
  await getRedis().del(key);
  return userId;
}

function verifyTOTP(secret: string, token: string): boolean {
  return speakeasy.totp.verify({
    secret,
    encoding: 'base32',
    token,
    window: 1,
  });
}

router.post(
  '/register',
  validate(registerBody, 'body'),
  async (req: Request, res: Response, next: NextFunction) => {
    if (mongoose.connection.readyState !== 1) {
      next(new AppError(503, SERVICE_UNAVAILABLE));
      return;
    }
    try {
      const { email, password, name, role, organizationId: rawOrg } = req.body as z.infer<typeof registerBody>;
      const organizationId = await resolveOrgId(rawOrg);
      if (!organizationId) {
        next(new AppError(400, 'Invalid organization code. Use the code from your instructor (e.g. platform).'));
        return;
      }
      const existing = await User.findOne({ organizationId, email });
      if (existing) {
        next(new AppError(409, 'Email already registered in this organization'));
        return;
      }
      const passwordHash = await bcrypt.hash(password, config.BCRYPT_ROUNDS);
      const user = await User.create({ email, passwordHash, name, role, organizationId });
      const payload: Omit<JwtPayload, 'type' | 'iat' | 'exp'> = {
        sub: user._id.toString(),
        role: user.role,
        organizationId: user.organizationId,
      };
      const accessToken = signAccessToken(payload);
      const refreshToken = signRefreshToken(payload);
      const decoded = jwt.decode(refreshToken) as { exp: number };
      const ttl = decoded?.exp ? Math.max(0, decoded.exp - Math.floor(Date.now() / 1000)) : 604800;
      try {
        await storeRefreshToken(user._id.toString(), refreshToken.slice(-16), ttl);
      } catch {
        /* Redis down: still return tokens; refresh may not work until Redis is up */
      }
      res.status(201).json({
        success: true,
        user: { id: user._id, email: user.email, name: user.name, role: user.role, organizationId: user.organizationId },
        accessToken,
        refreshToken,
        expiresIn: config.JWT_ACCESS_EXPIRES_IN,
      });
    } catch (e) {
      if (isDbOrConnectionError(e)) {
        next(new AppError(503, SERVICE_UNAVAILABLE));
        return;
      }
      next(e);
    }
  }
);

router.post(
  '/login',
  validate(loginBody, 'body'),
  async (req: Request, res: Response, next: NextFunction) => {
    if (mongoose.connection.readyState !== 1) {
      next(new AppError(503, SERVICE_UNAVAILABLE));
      return;
    }
    try {
      const { email, password, organizationId: rawOrg } = req.body as z.infer<typeof loginBody>;
      const organizationId = await resolveOrgId(rawOrg);
      if (!organizationId) {
        next(new AppError(401, 'Invalid organization code. Use the code from your instructor (e.g. platform).'));
        return;
      }
      const user = await User.findOne({ organizationId, email });
      if (!user) {
        next(new AppError(401, 'Invalid email or password'));
        return;
      }
      const ok = await bcrypt.compare(password, user.passwordHash);
      if (!ok) {
        next(new AppError(401, 'Invalid email or password'));
        return;
      }
      if (user.twoFactorEnabled && user.twoFactorSecret) {
        try {
          const crypto = await import('crypto');
          const tempToken = crypto.randomBytes(32).toString('hex');
          await setTemp2FAToken(tempToken, user._id.toString());
          return res.json({
            success: true,
            requires2FA: true,
            tempToken,
            message: 'Enter the code from your authenticator app',
          });
        } catch {
          /* Redis down: fall through to normal login */
        }
      }
      const payload: Omit<JwtPayload, 'type' | 'iat' | 'exp'> = {
        sub: user._id.toString(),
        role: user.role,
        organizationId: user.organizationId,
      };
      const accessToken = signAccessToken(payload);
      const refreshToken = signRefreshToken(payload);
      const decoded = jwt.decode(refreshToken) as { exp: number };
      const ttl = decoded?.exp ? Math.max(0, decoded.exp - Math.floor(Date.now() / 1000)) : 604800;
      try {
        await storeRefreshToken(user._id.toString(), refreshToken.slice(-16), ttl);
      } catch {
        /* Redis down: still return tokens */
      }
      return res.json({
        success: true,
        user: { id: user._id, email: user.email, name: user.name, role: user.role, organizationId: user.organizationId },
        accessToken,
        refreshToken,
        expiresIn: config.JWT_ACCESS_EXPIRES_IN,
      });
    } catch (e) {
      if (isDbOrConnectionError(e)) {
        return next(new AppError(503, SERVICE_UNAVAILABLE));
      }
      return next(e);
    }
  }
);

router.post(
  '/refresh',
  validate(refreshBody, 'body'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { refreshToken } = req.body as z.infer<typeof refreshBody>;
      const decoded = jwt.verify(refreshToken, config.JWT_REFRESH_SECRET) as JwtPayload & { sub: string };
      if (decoded.type !== 'refresh') {
        next(new AppError(401, 'Invalid token'));
        return;
      }
      const valid = await validateRefreshToken(decoded.sub, refreshToken.slice(-16));
      if (!valid) {
        next(new AppError(401, 'Refresh token invalid or revoked'));
        return;
      }
      const payload: Omit<JwtPayload, 'type' | 'iat' | 'exp'> = {
        sub: decoded.sub,
        role: decoded.role,
        organizationId: decoded.organizationId,
      };
      const accessToken = signAccessToken(payload);
      res.json({ success: true, accessToken, expiresIn: config.JWT_ACCESS_EXPIRES_IN });
    } catch {
      next(new AppError(401, 'Invalid or expired refresh token'));
    }
  }
);

router.post(
  '/forgot-password',
  validate(forgotBody, 'body'),
  async (req: Request, res: Response, next: NextFunction) => {
    if (mongoose.connection.readyState !== 1) {
      next(new AppError(503, SERVICE_UNAVAILABLE));
      return;
    }
    try {
      const { email, organizationId: rawOrg } = req.body as z.infer<typeof forgotBody>;
      const organizationId = await resolveOrgId(rawOrg);
      if (!organizationId) {
        next(new AppError(400, 'Invalid organization code.'));
        return;
      }
      const user = await User.findOne({ email, organizationId });
      if (!user) {
        res.json({ success: true, message: 'If that email exists in this organization, you will receive a reset link.' });
        return;
      }
      const crypto = await import('crypto');
      const token = crypto.randomBytes(32).toString('hex');
      await setResetToken(token, user._id.toString());
      const emailSent = await sendPasswordResetEmail(user.email, token);
      if (emailSent) {
        res.json({ success: true, message: 'If that email exists in this organization, you will receive a reset link.' });
        return;
      }
      if (config.NODE_ENV !== 'production') {
        res.json({ success: true, message: 'Reset link generated (SMTP not configured).', resetToken: token, resetUrl: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password?token=${token}` });
        return;
      }
      res.json({ success: true, message: 'If that email exists in this organization, you will receive a reset link.' });
    } catch (e) {
      if (isDbOrConnectionError(e)) {
        next(new AppError(503, SERVICE_UNAVAILABLE));
        return;
      }
      next(e);
    }
  }
);

router.post(
  '/reset-password',
  validate(resetBody, 'body'),
  async (req: Request, res: Response, next: NextFunction) => {
    if (mongoose.connection.readyState !== 1) {
      next(new AppError(503, SERVICE_UNAVAILABLE));
      return;
    }
    try {
      const { token, newPassword } = req.body as z.infer<typeof resetBody>;
      const userId = await consumeResetToken(token);
      if (!userId) {
        next(new AppError(400, 'Invalid or expired reset link. Request a new one.'));
        return;
      }
      const user = await User.findById(userId);
      if (!user) {
        next(new AppError(404, 'User not found'));
        return;
      }
      const passwordHash = await bcrypt.hash(newPassword, config.BCRYPT_ROUNDS);
      user.passwordHash = passwordHash;
      await user.save();
      res.json({ success: true, message: 'Password updated. You can sign in now.' });
    } catch (e) {
      if (isDbOrConnectionError(e)) {
        next(new AppError(503, SERVICE_UNAVAILABLE));
        return;
      }
      next(e);
    }
  }
);

router.post('/logout', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (req.user?.id) {
      try {
        await invalidateRefreshToken(req.user.id);
      } catch {
        /* Redis down */
      }
    }
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

router.get('/me', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await User.findById(req.user!.id).select('email name role organizationId twoFactorEnabled');
    if (!user) {
      next(new AppError(404, 'User not found'));
      return;
    }
    const org = await Organization.findById(user.organizationId).select('slug name').lean();
    res.json({
      success: true,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        role: user.role,
        organizationId: user.organizationId,
        organizationCode: org?.slug ?? null,
        organizationName: org?.name ?? null,
        twoFactorEnabled: !!user.twoFactorEnabled,
      },
    });
  } catch (e) {
    next(e);
  }
});

const changePasswordBody = z.object({
  currentPassword: z.string().min(1, 'Current password required'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
});

router.post(
  '/change-password',
  authMiddleware,
  validate(changePasswordBody, 'body'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { currentPassword, newPassword } = req.body as z.infer<typeof changePasswordBody>;
      const user = await User.findById(req.user!.id).select('passwordHash');
      if (!user || !user.passwordHash) {
        next(new AppError(404, 'User not found'));
        return;
      }
      const valid = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!valid) {
        next(new AppError(400, 'Current password is incorrect'));
        return;
      }
      user.passwordHash = await bcrypt.hash(newPassword, config.BCRYPT_ROUNDS);
      await user.save();
      res.json({ success: true, message: 'Password updated' });
    } catch (e) {
      next(e);
    }
  }
);

// --- 2FA (TOTP) ---
const twoFAVerifyLoginBody = z.object({ tempToken: z.string().min(1), code: z.string().length(6) });
const twoFAVerifyBody = z.object({ code: z.string().length(6) });

router.post(
  '/2fa/setup',
  authMiddleware,
  requireRoles('admin', 'super_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await User.findById(req.user!.id);
      if (!user) {
        next(new AppError(404, 'User not found'));
        return;
      }
      const secret = speakeasy.generateSecret({ name: `CBT:${user.email}`, length: 20 });
      user.twoFactorSecret = secret.base32;
      user.twoFactorEnabled = false;
      await user.save();
      const otpauthUrl = secret.otpauth_url ?? `otpauth://totp/CBT:${encodeURIComponent(user.email)}?secret=${secret.base32}`;
      const qrDataUrl = await QRCode.toDataURL(otpauthUrl, { width: 200, margin: 1 });
      res.json({ success: true, secret: secret.base32, otpauthUrl, qrDataUrl });
    } catch (e) {
      next(e);
    }
  }
);

router.post(
  '/2fa/verify-setup',
  authMiddleware,
  validate(twoFAVerifyBody, 'body'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { code } = req.body as z.infer<typeof twoFAVerifyBody>;
      const user = await User.findById(req.user!.id);
      if (!user || !user.twoFactorSecret) {
        next(new AppError(400, '2FA setup not started. Call /2fa/setup first.'));
        return;
      }
      if (!verifyTOTP(user.twoFactorSecret, code)) {
        next(new AppError(400, 'Invalid code'));
        return;
      }
      user.twoFactorEnabled = true;
      await user.save();
      res.json({ success: true, message: '2FA enabled' });
    } catch (e) {
      next(e);
    }
  }
);

router.post(
  '/2fa/verify-login',
  validate(twoFAVerifyLoginBody, 'body'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tempToken, code } = req.body as z.infer<typeof twoFAVerifyLoginBody>;
      const userId = await consumeTemp2FAToken(tempToken);
      if (!userId) {
        next(new AppError(401, 'Session expired. Please log in again.'));
        return;
      }
      const user = await User.findById(userId);
      if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
        next(new AppError(401, 'Invalid session'));
        return;
      }
      if (!verifyTOTP(user.twoFactorSecret, code)) {
        next(new AppError(401, 'Invalid code'));
        return;
      }
      const payload: Omit<JwtPayload, 'type' | 'iat' | 'exp'> = {
        sub: user._id.toString(),
        role: user.role,
        organizationId: user.organizationId,
      };
      const accessToken = signAccessToken(payload);
      const refreshToken = signRefreshToken(payload);
      const decoded = jwt.decode(refreshToken) as { exp: number };
      const ttl = decoded?.exp ? Math.max(0, decoded.exp - Math.floor(Date.now() / 1000)) : 604800;
      try {
        await storeRefreshToken(user._id.toString(), refreshToken.slice(-16), ttl);
      } catch {
        /* Redis down */
      }
      res.json({
        success: true,
        user: { id: user._id, email: user.email, name: user.name, role: user.role, organizationId: user.organizationId },
        accessToken,
        refreshToken,
        expiresIn: config.JWT_ACCESS_EXPIRES_IN,
      });
    } catch (e) {
      next(e);
    }
  }
);

router.post(
  '/2fa/disable',
  authMiddleware,
  validate(twoFAVerifyBody, 'body'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { code } = req.body as z.infer<typeof twoFAVerifyBody>;
      const user = await User.findById(req.user!.id);
      if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
        res.json({ success: true, message: '2FA was not enabled' });
        return;
      }
      if (!verifyTOTP(user.twoFactorSecret, code)) {
        next(new AppError(400, 'Invalid code'));
        return;
      }
      user.twoFactorEnabled = false;
      user.twoFactorSecret = undefined;
      await user.save();
      res.json({ success: true, message: '2FA disabled' });
    } catch (e) {
      next(e);
    }
  }
);

export default router;
