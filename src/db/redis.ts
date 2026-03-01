import Redis from 'ioredis';
import { logger } from '../utils/logger';
import { config } from '../config';

let redis: Redis | null = null;

const uri = config.REDIS_URI;
const isTls = uri.startsWith('rediss://');

export function getRedis(uriOverride?: string): Redis {
  if (!redis) {
    const u = uriOverride ?? uri;
    redis = new Redis(u, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => (times > 3 ? null : Math.min(times * 200, 2000)),
      lazyConnect: true,
      ...(isTls && {
        tls: {
          rejectUnauthorized: config.NODE_ENV === 'production',
        },
      }),
    });
    redis.on('connect', () => logger.info('Redis connected'));
    redis.on('error', (err) => logger.error({ err }, 'Redis error'));
  }
  return redis;
}

export async function connectRedis(_uri?: string): Promise<Redis> {
  const client = getRedis();
  await client.connect();
  return client;
}

export async function disconnectRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
    logger.info('Redis disconnected');
  }
}
