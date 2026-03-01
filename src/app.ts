import express from 'express';
import compression from 'compression';
import path from 'path';
import fs from 'fs';
import swaggerUi from 'swagger-ui-express';
import { config } from './config';
import {
  helmetMiddleware,
  corsMiddleware,
  rateLimitMiddleware,
  sanitizeMiddleware,
  hppMiddleware,
} from './middleware/security';
import { requestLogger } from './middleware/requestLogger';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import routes from './routes';

const app = express();

app.use(helmetMiddleware);
app.use(corsMiddleware);
app.use(compression());
app.use(express.json({ limit: '512kb' }));
app.use(express.urlencoded({ extended: true, limit: '512kb' }));
app.use(sanitizeMiddleware);
app.use(hppMiddleware);
app.use(requestLogger);

app.use(rateLimitMiddleware);

app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));

// OpenAPI spec (for Swagger UI and frontend). Inject PUBLIC_API_URL as server when set.
const openapiPath = path.join(__dirname, '..', 'openapi.yaml');
app.get(`${config.API_PREFIX}/openapi.yaml`, (_req, res) => {
  if (!fs.existsSync(openapiPath)) {
    res.status(404).json({ success: false, message: 'OpenAPI spec not found' });
    return;
  }
  let yaml = fs.readFileSync(openapiPath, 'utf8');
  const publicUrl = process.env.PUBLIC_API_URL?.trim();
  if (publicUrl) {
    const base = publicUrl.replace(/\/$/, '');
    const serverUrl = base.includes('/api/v1') ? base : `${base}/api/v1`;
    yaml = yaml.replace('https://your-api-domain.com/api/v1', serverUrl);
  }
  res.setHeader('Content-Type', 'application/x-yaml');
  res.send(yaml);
});

// Swagger UI
app.use(
  '/api-docs',
  swaggerUi.serve,
  swaggerUi.setup(undefined, {
    swaggerOptions: { url: `${config.API_PREFIX}/openapi.yaml` },
    customSiteTitle: 'LMS CBT API Docs',
  })
);

app.use(config.API_PREFIX, routes);
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
