import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import mongoSanitize from 'express-mongo-sanitize';
import hpp from 'hpp';
import { config } from '../config';

const corsOrigins = config.CORS_ORIGINS.split(',').map((o) => o.trim());
const allowAllOrigins = config.NODE_ENV === 'development' && (corsOrigins.length === 0 || corsOrigins[0] === '*');

export const helmetMiddleware = helmet({
  contentSecurityPolicy: config.NODE_ENV === 'production',
  crossOriginEmbedderPolicy: false,
});

export const corsMiddleware = cors({
  origin: allowAllOrigins ? true : corsOrigins.length === 1 && corsOrigins[0] === '*' ? true : corsOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-organization-id'],
});

export const rateLimitMiddleware = rateLimit({
  windowMs: config.RATE_LIMIT_WINDOW_MS,
  max: config.RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests' },
});

/** Strip $ and . from body/query to prevent NoSQL injection */
export const sanitizeMiddleware = mongoSanitize();

/** Prevent HTTP Parameter Pollution (e.g. ?id=1&id=2) */
export const hppMiddleware = hpp();
