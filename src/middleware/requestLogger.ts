import pinoHttp from 'pino-http';
import { logger } from '../utils/logger';

export const requestLogger = pinoHttp({
  logger,
  autoLogging: { ignore: (req) => req.url?.startsWith('/health') ?? false },
  customLogLevel: (_req, res, err) => {
    if (res.statusCode >= 500 || err) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
});
