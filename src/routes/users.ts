import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { z } from 'zod';
import { AppError } from '../middleware/errorHandler';
import { authMiddleware, requireRoles, tenantMiddleware } from '../middleware/auth';
import { config } from '../config';
import { validate } from '../utils/validate';
import { User } from '../models/User';

const router = Router();

const bulkUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(8).optional(),
});

const bulkBody = z.object({
  users: z.array(bulkUserSchema),
});

router.use(authMiddleware);
router.use(tenantMiddleware);

/** List users (students) in the organization – Admin or Super Admin */
router.get(
  '/',
  requireRoles('admin', 'super_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = req.organizationId;
      if (!orgId) {
        next(new AppError(400, 'x-organization-id required'));
        return;
      }
      const role = typeof req.query.role === 'string' ? req.query.role : undefined;
      const filter: { organizationId: string; role?: string } = { organizationId: orgId };
      if (role) filter.role = role;
      const users = await User.find(filter).select('email name role createdAt').sort({ createdAt: -1 }).lean();
      res.json({ success: true, users });
    } catch (e) {
      next(e);
    }
  }
);

/** Bulk create students (same organization) – Admin or Super Admin */
router.post(
  '/bulk',
  requireRoles('admin', 'super_admin'),
  validate(bulkBody, 'body'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = req.organizationId;
      if (!orgId) {
        next(new AppError(400, 'x-organization-id required'));
        return;
      }
      const items = (req.body as z.infer<typeof bulkBody>).users;
      if (items.length > 200) {
        next(new AppError(400, 'Maximum 200 users per bulk import'));
        return;
      }
      const created: number[] = [];
      const skipped: { index: number; reason: string }[] = [];
      const failed: { index: number; message: string }[] = [];
      for (let i = 0; i < items.length; i++) {
        const u = items[i];
        try {
          const existing = await User.findOne({ organizationId: orgId, email: u.email });
          if (existing) {
            skipped.push({ index: i, reason: 'Email already registered' });
            continue;
          }
          const password = u.password ?? crypto.randomBytes(8).toString('hex');
          const passwordHash = await bcrypt.hash(password, config.BCRYPT_ROUNDS);
          await User.create({
            organizationId: orgId,
            email: u.email,
            name: u.name,
            passwordHash,
            role: 'student',
          });
          created.push(i);
        } catch (err: any) {
          failed.push({ index: i, message: err.message || 'Failed to create' });
        }
      }
      res.status(201).json({
        success: true,
        created: created.length,
        skipped: skipped.length,
        failed: failed.length,
        skippedDetails: skipped.length ? skipped : undefined,
        errors: failed.length ? failed : undefined,
      });
    } catch (e) {
      next(e);
    }
  }
);

export default router;
