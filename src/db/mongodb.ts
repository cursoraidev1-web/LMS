import dns from 'dns';
import mongoose from 'mongoose';
import { logger } from '../utils/logger';
import { config } from '../config';

export async function connectMongo(uri?: string): Promise<void> {
  const connectionUri = uri ?? config.MONGODB_URI;
  if (connectionUri.startsWith('mongodb+srv://')) {
    dns.setServers(['8.8.8.8', '8.8.4.4']);
  }
  await mongoose.connect(connectionUri);
  logger.info('MongoDB connected');
}

mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
mongoose.connection.on('error', (err) => logger.error({ err }, 'MongoDB error'));
