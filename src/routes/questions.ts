import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AppError } from '../middleware/errorHandler';
import { authMiddleware, requireRoles, tenantMiddleware } from '../middleware/auth';
import { validate } from '../utils/validate';
import { Question } from '../models/Question';

const router = Router();

const optionSchema = z.object({ text: z.string().min(1), isCorrect: z.boolean() });

const createBody = z.object({
  type: z.enum(['mcq_single', 'mcq_multiple', 'true_false', 'short_answer']),
  body: z.string().min(1, 'Question body required'),
  options: z.array(optionSchema).optional(),
  correctAnswer: z.string().optional(),
  points: z.number().min(0).default(1),
});

const updateBody = createBody.partial();

const bulkBody = z.object({
  questions: z.array(createBody),
});

router.use(authMiddleware);
router.use(tenantMiddleware);

/** List questions (question bank) for the organization */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.organizationId;
    if (!orgId) {
      next(new AppError(400, 'Organization context required'));
      return;
    }
    const questions = await Question.find({ organizationId: orgId }).sort({ createdAt: -1 }).lean();
    res.json({ success: true, questions });
  } catch (e) {
    next(e);
  }
});

/** Create question – Admin or Super Admin (must be before /:id) */
router.post(
  ['/', ''],
  requireRoles('admin', 'super_admin'),
  validate(createBody, 'body'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = req.organizationId;
      if (!orgId) {
        next(new AppError(400, 'x-organization-id required'));
        return;
      }
      const question = await Question.create({
        organizationId: orgId,
        ...req.body,
      });
      res.status(201).json({ success: true, question });
    } catch (e) {
      next(e);
    }
  }
);

/** Get one question */
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.organizationId;
    if (!orgId) {
      next(new AppError(400, 'Organization context required'));
      return;
    }
    const question = await Question.findOne({ _id: req.params.id, organizationId: orgId }).lean();
    if (!question) {
      next(new AppError(404, 'Question not found'));
      return;
    }
    res.json({ success: true, question });
  } catch (e) {
    next(e);
  }
});

/** Bulk create questions – Admin or Super Admin */
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
      const items = (req.body as z.infer<typeof bulkBody>).questions;
      if (items.length > 200) {
        next(new AppError(400, 'Maximum 200 questions per bulk import'));
        return;
      }
      const failed: { index: number; message: string }[] = [];
      const created: unknown[] = [];
      for (let i = 0; i < items.length; i++) {
        try {
          const q = await Question.create({ organizationId: orgId, ...items[i] });
          created.push(q);
        } catch (err: any) {
          failed.push({ index: i, message: err.message || 'Validation failed' });
        }
      }
      res.status(201).json({
        success: true,
        created: created.length,
        failed: failed.length,
        errors: failed.length ? failed : undefined,
      });
    } catch (e) {
      next(e);
    }
  }
);

/** Update question */
router.patch(
  '/:id',
  requireRoles('admin', 'super_admin'),
  validate(updateBody, 'body'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = req.organizationId;
      if (!orgId) {
        next(new AppError(400, 'x-organization-id required'));
        return;
      }
      const question = await Question.findOneAndUpdate(
        { _id: req.params.id, organizationId: orgId },
        { $set: req.body },
        { new: true, runValidators: true }
      );
      if (!question) {
        next(new AppError(404, 'Question not found'));
        return;
      }
      res.json({ success: true, question });
    } catch (e) {
      next(e);
    }
  }
);

/** Delete question */
router.delete(
  '/:id',
  requireRoles('admin', 'super_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = req.organizationId;
      if (!orgId) {
        next(new AppError(400, 'x-organization-id required'));
        return;
      }
      const question = await Question.findOneAndDelete({ _id: req.params.id, organizationId: orgId });
      if (!question) {
        next(new AppError(404, 'Question not found'));
        return;
      }
      res.json({ success: true, message: 'Question deleted' });
    } catch (e) {
      next(e);
    }
  }
);

export default router;
