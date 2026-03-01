import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { AppError } from '../middleware/errorHandler';
import { authMiddleware, requireRoles, tenantMiddleware } from '../middleware/auth';
import { validate } from '../utils/validate';
import { Exam } from '../models/Exam';
import { Question } from '../models/Question';
import { ExamAttempt } from '../models/ExamAttempt';

const router = Router();

const createBody = z.object({
  title: z.string().min(1, 'Title required'),
  description: z.string().optional(),
  status: z.enum(['draft', 'published', 'archived']).optional().default('draft'),
  scheduledAt: z.string().datetime().optional().or(z.date()).optional(),
  durationMinutes: z.number().min(1).default(60),
  passMark: z.number().min(0).max(100).default(60),
  questionIds: z.array(z.string()).optional().default([]),
  shuffleQuestions: z.boolean().optional().default(true),
});

const updateBody = createBody.partial();

router.use(authMiddleware);
router.use(tenantMiddleware);

/** List exams for the organization – Admin sees all; Student sees published only. Students get userAttemptStatus per exam. */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.organizationId;
    if (!orgId) {
      next(new AppError(400, 'Organization context required'));
      return;
    }
    const filter: Record<string, unknown> = { organizationId: orgId };
    if (req.user?.role === 'student') {
      filter.status = 'published';
    }
    const exams = await Exam.find(filter).sort({ createdAt: -1 }).lean();
    if (req.user?.role === 'student' && req.user?.id && exams.length > 0) {
      const examIds = (exams as any[]).map((e) => e._id);
      const attempts = await ExamAttempt.find({
        organizationId: orgId,
        userId: req.user.id,
        examId: { $in: examIds },
      })
        .select('examId status _id')
        .lean();
      const attemptByExam: Record<string, { status: string; attemptId: string }> = {};
      for (const a of attempts as any[]) {
        const eid = a.examId?.toString();
        if (!eid) continue;
        const current = attemptByExam[eid];
        if (!current || a.status === 'submitted') {
          attemptByExam[eid] = { status: a.status, attemptId: a._id?.toString() };
        }
      }
      const withStatus = (exams as any[]).map((e) => {
        const a = attemptByExam[e._id.toString()];
        return {
          ...e,
          userAttemptStatus: a?.status ?? 'none',
          userAttemptId: a?.attemptId ?? null,
        };
      });
      return res.json({ success: true, exams: withStatus });
    }
    return res.json({ success: true, exams });
  } catch (e) {
    return next(e);
  }
});

/** Exam statistics (attempts, pass rate, average score) – Admin/Super Admin */
router.get(
  '/:id/stats',
  requireRoles('admin', 'super_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = req.organizationId;
      if (!orgId) {
        next(new AppError(400, 'Organization context required'));
        return;
      }
      const exam = await Exam.findOne({ _id: req.params.id, organizationId: orgId }).lean();
      if (!exam) {
        next(new AppError(404, 'Exam not found'));
        return;
      }
      const submitted = await ExamAttempt.find({
        organizationId: orgId,
        examId: new mongoose.Types.ObjectId(req.params.id),
        status: 'submitted',
      }).lean();
      const total = submitted.length;
      const passed = submitted.filter((a) => a.passed).length;
      const passRate = total > 0 ? Math.round((passed / total) * 1000) / 10 : 0;
      let avgScore = 0;
      if (total > 0) {
        const sum = submitted.reduce((acc, a) => acc + (a.score ?? 0), 0);
        const maxSum = submitted.reduce((acc, a) => acc + (a.maxScore ?? 0), 0);
        avgScore = maxSum > 0 ? Math.round((sum / maxSum) * 1000) / 10 : 0;
      }
      res.json({
        success: true,
        stats: {
          examId: req.params.id,
          title: exam.title,
          totalAttempts: total,
          passed,
          passRate,
          averageScorePercent: avgScore,
        },
      });
    } catch (e) {
      next(e);
    }
  }
);

/** Get one exam by ID (with questions for admin; for student only if published) */
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.organizationId;
    if (!orgId) {
      next(new AppError(400, 'Organization context required'));
      return;
    }
    const exam = await Exam.findOne({ _id: req.params.id, organizationId: orgId }).lean();
    if (!exam) {
      next(new AppError(404, 'Exam not found'));
      return;
    }
    if (req.user?.role === 'student' && exam.status !== 'published') {
      next(new AppError(403, 'Exam not available'));
      return;
    }
    const questions = await Question.find({
      _id: { $in: exam.questionIds || [] },
      organizationId: orgId,
    }).lean();
    const questionMap = Object.fromEntries(questions.map((q) => [q._id.toString(), q]));
    const ordered = (exam.questionIds || []).map((id: mongoose.Types.ObjectId) => questionMap[id.toString()]).filter(Boolean);
    res.json({ success: true, exam: { ...exam, questions: ordered } });
  } catch (e) {
    next(e);
  }
});

/** Create exam – Admin or Super Admin */
router.post(
  '/',
  requireRoles('admin', 'super_admin'),
  validate(createBody, 'body'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = req.organizationId;
      if (!orgId) {
        next(new AppError(400, 'x-organization-id required'));
        return;
      }
      const body = req.body as z.infer<typeof createBody>;
      const questionIds = (body.questionIds || [])
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));
      const exam = await Exam.create({
        organizationId: orgId,
        title: body.title,
        description: body.description,
        status: body.status,
        scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : undefined,
        durationMinutes: body.durationMinutes,
        passMark: body.passMark,
        questionIds,
        shuffleQuestions: body.shuffleQuestions ?? true,
      });
      res.status(201).json({ success: true, exam });
    } catch (e) {
      next(e);
    }
  }
);

/** Update exam */
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
      const body = req.body as z.infer<typeof updateBody>;
      const update: Record<string, unknown> = { ...body };
      if (body.questionIds) {
        update.questionIds = body.questionIds
          .filter((id: string) => mongoose.Types.ObjectId.isValid(id))
          .map((id: string) => new mongoose.Types.ObjectId(id));
      }
      if (body.scheduledAt) update.scheduledAt = new Date(body.scheduledAt as string);
      const exam = await Exam.findOneAndUpdate(
        { _id: req.params.id, organizationId: orgId },
        { $set: update },
        { new: true, runValidators: true }
      );
      if (!exam) {
        next(new AppError(404, 'Exam not found'));
        return;
      }
      res.json({ success: true, exam });
    } catch (e) {
      next(e);
    }
  }
);

/** Delete exam */
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
      const exam = await Exam.findOneAndDelete({ _id: req.params.id, organizationId: orgId });
      if (!exam) {
        next(new AppError(404, 'Exam not found'));
        return;
      }
      res.json({ success: true, message: 'Exam deleted' });
    } catch (e) {
      next(e);
    }
  }
);

export default router;
