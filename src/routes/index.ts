import { Router } from 'express';
import healthRoutes from './health';
import authRoutes from './auth';
import organizationRoutes from './organizations';
import examRoutes from './exams';
import questionRoutes from './questions';
import attemptRoutes from './attempts';
import userRoutes from './users';
import dashboardRoutes from './dashboard';

const router = Router();

router.use('/health', healthRoutes);
router.use('/auth', authRoutes);
router.use('/organizations', organizationRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/exams', examRoutes);
router.use('/questions', questionRoutes);
router.use('/attempts', attemptRoutes);
router.use('/users', userRoutes);

// API v1 – list all endpoints (proposal-aligned)
router.get('/', (_req, res) => {
  res.json({
    success: true,
    name: 'LMS CBT API',
    version: '1.0',
    docs: 'Aligned with Project Proposal (Feb 2025). Phase 1 & 2 backend complete.',
    endpoints: {
      health: 'GET /health/ready, /health/live',
      auth: 'POST /auth/register, login, refresh, logout, forgot-password, reset-password, GET /auth/me',
      'auth-2fa': 'POST /auth/2fa/setup, verify-setup, verify-login, disable',
      organizations: 'GET/POST/PATCH/DELETE /organizations (Super Admin)',
      exams: 'GET/POST/PATCH/DELETE /exams, GET /exams/:id/stats (analytics)',
      questions: 'GET/POST/PATCH/DELETE /questions, POST /questions/bulk',
      attempts: 'POST /attempts/start, PATCH /attempts/:id, POST /attempts/:id/submit, GET /attempts, GET /attempts/:id, PATCH /attempts/:id/grades, GET /attempts/export?examId=&format=csv|excel',
      users: 'GET /users, POST /users/bulk (students)',
    },
  });
});

export default router;
