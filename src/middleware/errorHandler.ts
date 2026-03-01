import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { config } from '../config';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public isOperational = true
  ) {
    super(message);
    Object.setPrototypeOf(this, AppError.prototype);
    Error.captureStackTrace(this, this.constructor);
  }
}

export function errorHandler(
  err: Error | AppError,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  const statusCode = err instanceof AppError ? err.statusCode : 500;
  const message = err instanceof AppError ? err.message : 'Internal server error';

  if (statusCode >= 500) {
    logger.error({ err, statusCode }, 'Server error');
  } else {
    logger.warn({ err: err.message, statusCode }, 'Client error');
  }

  res.status(statusCode).json({
    success: false,
    message: config.NODE_ENV === 'production' && statusCode === 500 ? 'Internal server error' : message,
  });
}

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(new AppError(404, `Not found: ${req.method} ${req.originalUrl}`));
}
