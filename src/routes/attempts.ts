import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { AppError } from '../middleware/errorHandler';
import { authMiddleware, requireRoles, tenantMiddleware } from '../middleware/auth';
import { validate } from '../utils/validate';
import { Exam } from '../models/Exam';
import { Question } from '../models/Question';
import { ExamAttempt } from '../models/ExamAttempt';
import { User } from '../models/User';

const router = Router();

const submitBody = z.object({
  answers: z.array(
    z.object({
      questionId: z.string(),
      value: z.union([z.string(), z.array(z.string())]),
    })
  ),
  securityEvents: z.array(z.object({ type: z.string(), at: z.union([z.string(), z.date()]) })).optional(),
});

router.use(authMiddleware);
router.use(tenantMiddleware);

const startBody = z.object({ examId: z.string().min(1) });

/** Start an exam – creates an in_progress attempt if none */
router.post('/start', validate(startBody, 'body'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.organizationId;
    const userId = req.user?.id;
    if (!orgId || !userId) {
      next(new AppError(401, 'Authentication and organization required'));
      return;
    }
    const examId = (req.body as z.infer<typeof startBody>).examId;
    const exam = await Exam.findOne({ _id: examId, organizationId: orgId });
    if (!exam) {
      next(new AppError(404, 'Exam not found'));
      return;
    }
    if (exam.status !== 'published') {
      next(new AppError(403, 'Exam is not available to take'));
      return;
    }
    const existingSubmitted = await ExamAttempt.findOne({
      organizationId: String(orgId),
      examId: new mongoose.Types.ObjectId(examId),
      userId: String(userId),
      status: 'submitted',
    }).lean();
    if (existingSubmitted) {
      return next(new AppError(403, 'You have already completed this exam. No retakes allowed.'));
    }
    let attempt = await ExamAttempt.findOne({
      organizationId: orgId,
      examId,
      userId,
      status: 'in_progress',
    });
    if (attempt) {
      return res.json({ success: true, attempt, exam: { durationMinutes: exam.durationMinutes, title: exam.title } });
    }
    attempt = await ExamAttempt.create({
      organizationId: orgId,
      examId: new mongoose.Types.ObjectId(examId),
      userId,
      status: 'in_progress',
      startedAt: new Date(),
      answers: [],
    });
    return res.status(201).json({
      success: true,
      attempt,
      exam: { durationMinutes: exam.durationMinutes, title: exam.title },
    });
  } catch (e) {
    next(e);
  }
});

/** Save answers (auto-save) – student only, in_progress attempt */
router.patch(
  '/:attemptId',
  requireRoles('student', 'admin', 'super_admin'),
  validate(
    z.object({
      answers: z.array(
        z.object({
          questionId: z.string(),
          value: z.union([z.string(), z.array(z.string())]),
        })
      ),
    }),
    'body'
  ),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = req.organizationId;
      const userId = req.user?.id;
      if (!orgId || !userId) {
        next(new AppError(401, 'Authentication required'));
        return;
      }
      const attempt = await ExamAttempt.findOne({
        _id: req.params.attemptId,
        organizationId: orgId,
        userId,
        status: 'in_progress',
      });
      if (!attempt) {
        next(new AppError(404, 'Attempt not found or already submitted'));
        return;
      }
      attempt.answers = req.body.answers.map((a: { questionId: string; value: string | string[] }) => ({
        questionId: new mongoose.Types.ObjectId(a.questionId),
        value: a.value,
      }));
      await attempt.save();
      res.json({ success: true, attempt });
    } catch (e) {
      next(e);
    }
  }
);

const gradesBody = z.object({
  grades: z.array(z.object({ questionId: z.string(), pointsAwarded: z.number().min(0) })),
});

/** Set manual grades for (e.g. short_answer) questions – Admin/Super Admin, submitted attempts only */
router.patch(
  '/:id/grades',
  requireRoles('admin', 'super_admin'),
  validate(gradesBody, 'body'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = req.organizationId;
      if (!orgId) {
        next(new AppError(400, 'Organization context required'));
        return;
      }
      const attempt = await ExamAttempt.findOne({
        _id: req.params.id,
        organizationId: orgId,
        status: 'submitted',
      });
      if (!attempt) {
        next(new AppError(404, 'Attempt not found or not submitted'));
        return;
      }
      const gradeMap = Object.fromEntries(
        (req.body as z.infer<typeof gradesBody>).grades.map((g) => [g.questionId, g.pointsAwarded])
      );
      const exam = await Exam.findOne({ _id: attempt.examId, organizationId: orgId });
      const questions = await Question.find({
        _id: { $in: attempt.answers.map((a) => a.questionId) },
        organizationId: orgId,
      }).lean();
      const qPoints = Object.fromEntries(questions.map((q) => [q._id.toString(), q.points ?? 1]));
      let score = 0;
      let maxScore = 0;
      for (const a of attempt.answers) {
        const qid = a.questionId.toString();
        const possible = a.pointsPossible ?? qPoints[qid] ?? 0;
        if (a.pointsPossible === undefined) a.pointsPossible = possible;
        const awarded = gradeMap[qid] !== undefined ? gradeMap[qid] : (a.pointsAwarded ?? 0);
        a.pointsAwarded = awarded;
        score += awarded;
        maxScore += possible;
      }
      attempt.score = score;
      attempt.maxScore = maxScore;
      const passMark = exam?.passMark ?? 0;
      attempt.passed = maxScore > 0 ? (score / maxScore) * 100 >= passMark : false;
      await attempt.save();
      res.json({ success: true, attempt: attempt.toObject() });
    } catch (e) {
      next(e);
    }
  }
);

function gradeAnswer(question: { type: string; options?: { text: string; isCorrect: boolean }[]; correctAnswer?: string }, value: string | string[]): number {
  if (question.type === 'mcq_single' && typeof value === 'string') {
    const opt = question.options?.find((o) => o.text === value);
    return opt?.isCorrect ? 1 : 0;
  }
  if (question.type === 'mcq_multiple' && Array.isArray(value)) {
    const correct = new Set(question.options?.filter((o) => o.isCorrect).map((o) => o.text) || []);
    const chosen = new Set(value);
    if (chosen.size !== correct.size) return 0;
    for (const c of chosen) if (!correct.has(c)) return 0;
    return 1;
  }
  if (question.type === 'true_false' && typeof value === 'string') {
    const expected = (question.correctAnswer || '').toLowerCase();
    return (value || '').toLowerCase() === expected ? 1 : 0;
  }
  if (question.type === 'short_answer' && typeof value === 'string') {
    const expected = (question.correctAnswer || '').trim().toLowerCase();
    return (value || '').trim().toLowerCase() === expected ? 1 : 0;
  }
  return 0;
}

/** Submit attempt – grades and marks submitted */
router.post(
  '/:attemptId/submit',
  requireRoles('student', 'admin', 'super_admin'),
  validate(submitBody, 'body'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = req.organizationId;
      const userId = req.user?.id;
      if (!orgId || !userId) {
        next(new AppError(401, 'Authentication required'));
        return;
      }
      const attempt = await ExamAttempt.findOne({
        _id: req.params.attemptId,
        organizationId: orgId,
        userId,
        status: 'in_progress',
      });
      if (!attempt) {
        next(new AppError(404, 'Attempt not found or already submitted'));
        return;
      }
      const exam = await Exam.findOne({ _id: attempt.examId, organizationId: orgId });
      if (!exam) {
        next(new AppError(404, 'Exam not found'));
        return;
      }
      const questions = await Question.find({
        _id: { $in: exam.questionIds || [] },
        organizationId: orgId,
      }).lean();
      const qMap = Object.fromEntries(questions.map((q) => [q._id.toString(), q]));
      let score = 0;
      let maxScore = 0;
      const answers = (req.body.answers as { questionId: string; value: string | string[] }[]).map((a) => {
        const q = qMap[a.questionId];
        const points = q?.points ?? 1;
        maxScore += points;
        const correct = q ? gradeAnswer(q, a.value) : 0;
        const pointsAwarded = q ? correct * points : 0;
        score += pointsAwarded;
        return {
          questionId: new mongoose.Types.ObjectId(a.questionId),
          value: a.value,
          pointsAwarded,
          pointsPossible: points,
        };
      });
      const percentage = maxScore > 0 ? (score / maxScore) * 100 : 0;
      const passed = percentage >= exam.passMark;
      attempt.answers = answers;
      attempt.score = score;
      attempt.maxScore = maxScore;
      attempt.passed = passed;
      attempt.status = 'submitted';
      attempt.submittedAt = new Date();
      const securityEvents = (req.body as { securityEvents?: { type: string; at: string | Date }[] }).securityEvents;
      if (Array.isArray(securityEvents) && securityEvents.length > 0) {
        attempt.securityEvents = securityEvents.map((e) => ({ type: e.type, at: typeof e.at === 'string' ? new Date(e.at) : e.at }));
      }
      await attempt.save();
      res.json({
        success: true,
        attempt: attempt.toObject(),
        result: { score, maxScore, percentage, passed },
      });
    } catch (e) {
      next(e);
    }
  }
);

/** List my attempts (student) or all attempts for an exam (admin) */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.organizationId;
    if (!orgId) {
      next(new AppError(400, 'Organization context required'));
      return;
    }
    const examId = req.query.examId as string | undefined;
    const userId = req.query.userId as string | undefined;
    const status = req.query.status as string | undefined;
    const filter: Record<string, unknown> = { organizationId: orgId };
    if (req.user?.role === 'student') {
      filter.userId = req.user.id;
    } else {
      if (examId) filter.examId = new mongoose.Types.ObjectId(examId);
      if (userId) filter.userId = userId;
    }
    if (status === 'in_progress' || status === 'submitted') {
      filter.status = status;
    }
    const attempts = await ExamAttempt.find(filter).sort({ createdAt: -1 }).lean();
    if (attempts.length === 0) {
      return res.json({ success: true, attempts: [] });
    }
    const examIds = [...new Set(attempts.map((a: any) => a.examId?.toString()).filter(Boolean))];
    const exams = await Exam.find({ _id: { $in: examIds.map((id) => new mongoose.Types.ObjectId(id)) } }).select('title').lean();
    const examTitles: Record<string, string> = Object.fromEntries((exams as any[]).map((e) => [e._id.toString(), e.title || '']));
    const withExamTitle = attempts.map((a: any) => ({
      ...a,
      examTitle: examTitles[a.examId?.toString()] ?? '—',
    }));
    if (req.user?.role === 'admin' || req.user?.role === 'super_admin') {
      const userIds = [...new Set(withExamTitle.map((a: any) => a.userId))];
      const users = await User.find({ _id: { $in: userIds } }).select('_id name email').lean();
      const userMap = Object.fromEntries((users as any[]).map((u) => [u._id.toString(), u]));
      const attemptsWithUser = withExamTitle.map((a: any) => ({
        ...a,
        user: userMap[a.userId] ? { name: userMap[a.userId].name, email: userMap[a.userId].email } : null,
      }));
      return res.json({ success: true, attempts: attemptsWithUser });
    }
    return res.json({ success: true, attempts: withExamTitle });
  } catch (e) {
    return next(e);
  }
});

/** Export attempts as CSV – Admin/Super Admin, requires examId */
router.get(
  '/export',
  requireRoles('admin', 'super_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = req.organizationId;
      const examId = req.query.examId as string | undefined;
      const format = (req.query.format as string) || 'csv';
      if (!orgId || !examId) {
        next(new AppError(400, 'examId is required for export'));
        return;
      }
      const attempts = await ExamAttempt.find({
        organizationId: orgId,
        examId: new mongoose.Types.ObjectId(examId),
        status: 'submitted',
      }).sort({ submittedAt: 1 }).lean();
      const userIds = [...new Set(attempts.map((a) => a.userId))];
      const users = await User.find({ _id: { $in: userIds } }).select('_id name email').lean();
      const userMap = Object.fromEntries(users.map((u) => [u._id.toString(), u]));
      if (format === 'csv') {
        const header = 'Email,Name,Score,MaxScore,Percentage,Passed,SubmittedAt';
        const rows = attempts.map((a) => {
          const u = userMap[a.userId];
          const pct = (a.maxScore ?? 0) > 0 ? ((a.score ?? 0) / (a.maxScore ?? 1) * 100).toFixed(1) : '0';
          const passed = a.passed ? 'Yes' : 'No';
          const submitted = a.submittedAt ? new Date(a.submittedAt).toISOString() : '';
          const email = (u?.email ?? '').replace(/"/g, '""');
          const name = (u?.name ?? '').replace(/"/g, '""');
          return `"${email}","${name}",${a.score ?? 0},${a.maxScore ?? 0},${pct},${passed},${submitted}`;
        });
        const csv = [header, ...rows].join('\r\n');
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="attempts-${examId}.csv"`);
        res.send(csv);
        return;
      }
      if (format === 'excel' || format === 'xlsx') {
        const XLSX = await import('xlsx');
        const rows = attempts.map((a) => {
          const u = userMap[a.userId];
          const pct = (a.maxScore ?? 0) > 0 ? ((a.score ?? 0) / (a.maxScore ?? 1) * 100).toFixed(1) : '0';
          return {
            Email: u?.email ?? '',
            Name: u?.name ?? '',
            Score: a.score ?? 0,
            MaxScore: a.maxScore ?? 0,
            Percentage: pct,
            Passed: a.passed ? 'Yes' : 'No',
            SubmittedAt: a.submittedAt ? new Date(a.submittedAt).toISOString() : '',
          };
        });
        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Attempts');
        const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="attempts-${examId}.xlsx"`);
        res.send(buf);
        return;
      }
      next(new AppError(400, 'Unsupported format. Use format=csv or format=excel'));
    } catch (e) {
      next(e);
    }
  }
);

/** Get one attempt by ID */
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.organizationId;
    const userId = req.user?.id;
    if (!orgId || !userId) {
      next(new AppError(401, 'Authentication required'));
      return;
    }
    const attempt = await ExamAttempt.findOne({
      _id: req.params.id,
      organizationId: orgId,
    }).lean();
    if (!attempt) {
      next(new AppError(404, 'Attempt not found'));
      return;
    }
    if (req.user?.role === 'student' && attempt.userId !== userId) {
      next(new AppError(403, 'Access denied'));
      return;
    }
    res.json({ success: true, attempt });
  } catch (e) {
    next(e);
  }
});

export default router;
