import { Router, Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { AppError } from '../middleware/errorHandler';
import { authMiddleware, tenantMiddleware } from '../middleware/auth';
import { Exam } from '../models/Exam';
import { Question } from '../models/Question';
import { ExamAttempt } from '../models/ExamAttempt';
import { User } from '../models/User';

const router = Router();

router.use(authMiddleware);
router.use(tenantMiddleware);

/** Role-based dashboard stats for the current organization */
router.get('/stats', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.organizationId;
    const userId = req.user?.id;
    const role = req.user?.role;
    if (!orgId) {
      next(new AppError(400, 'Organization context required'));
      return;
    }

    if (role === 'student') {
      const myAttempts = await ExamAttempt.find({ organizationId: orgId, userId }).sort({ submittedAt: -1 }).limit(5).lean();
      const totalAttempts = await ExamAttempt.countDocuments({ organizationId: orgId, userId, status: 'submitted' });
      const publishedExams = await Exam.countDocuments({ organizationId: orgId, status: 'published' });
      const examIdList = [...new Set(myAttempts.map((a: any) => a.examId?.toString()).filter(Boolean))];
      const exams = examIdList.length > 0
        ? await Exam.find({ _id: { $in: examIdList.map((id) => new mongoose.Types.ObjectId(id)) } }).select('title').lean()
        : [];
      const examTitles: Record<string, string> = Object.fromEntries((exams as any[]).map((e) => [e._id.toString(), e.title || '']));
      return res.json({
        success: true,
        stats: {
          totalAttempts,
          publishedExamsAvailable: publishedExams,
          recentAttempts: myAttempts.map((a: any) => ({
            id: a._id,
            examId: a.examId?.toString(),
            examTitle: examTitles[a.examId?.toString()] || '—',
            score: a.score,
            maxScore: a.maxScore,
            passed: a.passed,
            submittedAt: a.submittedAt,
          })),
        },
      });
    }

    // Admin / Super Admin
    const [examsCount, questionsCount, studentsCount, recentAttempts] = await Promise.all([
      Exam.countDocuments({ organizationId: orgId }),
      Question.countDocuments({ organizationId: orgId }),
      User.countDocuments({ organizationId: orgId, role: 'student' }),
      ExamAttempt.find({ organizationId: orgId, status: 'submitted' })
        .sort({ submittedAt: -1 })
        .limit(10)
        .lean(),
    ]);

    const examIdList = [...new Set(recentAttempts.map((a: any) => a.examId?.toString()).filter(Boolean))];
    const exams = await Exam.find({ _id: { $in: examIdList } }).select('title').lean();
    const examTitles: Record<string, string> = Object.fromEntries(exams.map((e: any) => [e._id.toString(), e.title || '']));

    const attemptCounts = await ExamAttempt.aggregate([
      { $match: { organizationId: orgId, status: 'submitted' } },
      { $group: { _id: '$examId', count: { $sum: 1 }, passed: { $sum: { $cond: ['$passed', 1, 0] } } } },
    ]);
    const summaryExamIds = attemptCounts.map((x: any) => x._id).filter(Boolean);
    const summaryExams = summaryExamIds.length > 0
      ? await Exam.find({ _id: { $in: summaryExamIds } }).select('title').lean()
      : [];
    const summaryTitles: Record<string, string> = Object.fromEntries((summaryExams as any[]).map((e) => [e._id.toString(), e.title || '']));

    return res.json({
      success: true,
      stats: {
        examsCount,
        questionsCount,
        studentsCount,
        recentAttempts: recentAttempts.map((a: any) => ({
          id: a._id,
          examId: a.examId?.toString(),
          examTitle: examTitles[a.examId?.toString()] || '—',
          userId: a.userId,
          score: a.score,
          maxScore: a.maxScore,
          passed: a.passed,
          submittedAt: a.submittedAt,
        })),
        attemptSummary: attemptCounts.map((x: any) => ({
          examId: x._id?.toString(),
          examTitle: summaryTitles[x._id?.toString()] || '—',
          totalAttempts: x.count,
          passed: x.passed,
        })),
      },
    });
  } catch (e) {
    return next(e);
  }
});

export default router;
