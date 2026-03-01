import pino from 'pino';
import { config } from '../config';

export const logger = pino({
  level: config.LOG_LEVEL,
  ...(config.NODE_ENV === 'development' && {
    transport: { target: 'pino-pretty', options: { colorize: true } },
  }),
  base: { pid: process.pid },
  timestamp: pino.stdTimeFunctions.isoTime,
});
