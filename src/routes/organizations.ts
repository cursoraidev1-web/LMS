import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AppError } from '../middleware/errorHandler';
import { authMiddleware, requireRoles } from '../middleware/auth';
import { validate } from '../utils/validate';
import { Organization } from '../models/Organization';

const router = Router();

const createBody = z.object({
  name: z.string().min(1, 'Name required'),
  slug: z.string().min(1, 'Slug required').regex(/^[a-z0-9_-]+$/, 'Slug: lowercase letters, numbers, _ and - only'),
  status: z.enum(['active', 'suspended', 'trial']).optional().default('active'),
  settings: z
    .object({
      maxUsers: z.number().min(0).optional(),
      maxExams: z.number().min(0).optional(),
      allowRegistration: z.boolean().optional(),
    })
    .optional(),
});

const updateBody = z.object({
  name: z.string().min(1).optional(),
  slug: z.string().min(1).regex(/^[a-z0-9_-]+$/).optional(),
  status: z.enum(['active', 'suspended', 'trial']).optional(),
  settings: createBody.shape.settings.optional(),
});

/** Public: get organization by code (slug) for login/register – no auth required */
router.get('/by-code/:code', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const code = (req.params.code || '').trim().toLowerCase();
    if (!code) {
      next(new AppError(400, 'Code required'));
      return;
    }
    const org = await Organization.findOne({ slug: code }).select('name slug _id').lean();
    if (!org) {
      next(new AppError(404, 'Organization not found'));
      return;
    }
    res.json({ success: true, organization: { id: org._id, name: org.name, code: org.slug } });
  } catch (e) {
    next(e);
  }
});

router.use(authMiddleware);

/** List organizations – Super Admin: all; Admin/Student: single org (current) */
router.get(
  '/',
  authMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (req.user?.role === 'super_admin') {
        const list = await Organization.find({}).sort({ createdAt: -1 }).lean();
        return res.json({ success: true, organizations: list });
      }
      const orgId = req.user?.organizationId;
      if (!orgId) {
        next(new AppError(400, 'Organization context required'));
        return;
      }
      const org = await Organization.findById(orgId).lean();
      if (!org) {
        return res.json({ success: true, organizations: [], message: 'Your organization was not found. Register using the Organization ID from your admin or run seed.' });
      }
      return res.json({ success: true, organizations: [org] });
    } catch (e) {
      return next(e);
    }
  }
);

/** Get one organization by ID – Super Admin any; Admin/Student own org only */
router.get(
  '/:id',
  authMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      if (req.user?.role !== 'super_admin' && req.user?.organizationId !== id) {
        next(new AppError(403, 'Access denied'));
        return;
      }
      const org = await Organization.findById(id).lean();
      if (!org) {
        next(new AppError(404, 'Organization not found'));
        return;
      }
      res.json({ success: true, organization: org });
    } catch (e) {
      next(e);
    }
  }
);

/** Create organization – Super Admin only */
router.post(
  '/',
  authMiddleware,
  requireRoles('super_admin'),
  validate(createBody, 'body'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const existing = await Organization.findOne({ slug: req.body.slug });
      if (existing) {
        next(new AppError(409, 'Organization slug already in use'));
        return;
      }
      const org = await Organization.create(req.body);
      res.status(201).json({ success: true, organization: org });
    } catch (e) {
      next(e);
    }
  }
);

/** Update organization – Super Admin only */
router.patch(
  '/:id',
  authMiddleware,
  requireRoles('super_admin'),
  validate(updateBody, 'body'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const org = await Organization.findByIdAndUpdate(
        req.params.id,
        { $set: req.body },
        { new: true, runValidators: true }
      );
      if (!org) {
        next(new AppError(404, 'Organization not found'));
        return;
      }
      res.json({ success: true, organization: org });
    } catch (e) {
      next(e);
    }
  }
);

/** Delete organization – Super Admin only (soft: suspend first in production) */
router.delete(
  '/:id',
  authMiddleware,
  requireRoles('super_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const org = await Organization.findByIdAndDelete(req.params.id);
      if (!org) {
        next(new AppError(404, 'Organization not found'));
        return;
      }
      res.json({ success: true, message: 'Organization deleted' });
    } catch (e) {
      next(e);
    }
  }
);

export default router;
