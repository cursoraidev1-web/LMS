import app from './app';
import { config } from './config';
import { logger } from './utils/logger';
import { connectMongo } from './db/mongodb';
import { connectRedis, disconnectRedis } from './db/redis';

const server = app.listen(config.PORT, async () => {
  try {
    await connectMongo();
  } catch (err) {
    logger.error({ err }, 'MongoDB connection failed - server is up but /register and /login will fail until DB is connected');
  }
  try {
    await connectRedis();
  } catch (err) {
    logger.warn({ err }, 'Redis connection failed - server will start but auth refresh/logout may fail');
  }
  logger.info({ port: config.PORT, env: config.NODE_ENV }, 'Server started');
  const base = `http://localhost:${config.PORT}`;
  logger.info(`API docs (Swagger): ${base}/api-docs | OpenAPI spec: ${base}/api/v1/openapi.yaml`);
});

function gracefulShutdown(signal: string): void {
  logger.info({ signal }, 'Shutting down');
  server.close(async () => {
    await disconnectRedis();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
