declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        sub: string;
        role: 'student' | 'admin' | 'super_admin';
        organizationId?: string;
        type: string;
      };
      organizationId?: string | null;
    }
  }
}

export {};
