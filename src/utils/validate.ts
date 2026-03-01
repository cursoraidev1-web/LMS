import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { AppError } from '../middleware/errorHandler';

type Source = 'body' | 'query' | 'params' | 'headers';

export function validate(schema: ZodSchema, source: Source = 'body') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const data = req[source];
    const result = schema.safeParse(data);
    if (result.success) {
      req[source] = result.data;
      next();
      return;
    }
    const err = result.error as ZodError;
    const message = err.flatten().fieldErrors
      ? Object.entries(err.flatten().fieldErrors)
          .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
          .join('; ')
      : 'Validation failed';
    next(new AppError(400, message));
  };
}
