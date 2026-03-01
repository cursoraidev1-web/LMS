import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import app from '../app';
import { connectMongo } from '../db/mongodb';
import { connectRedis } from '../db/redis';
import { User } from '../models/User';
import { getRedis } from '../db/redis';

describe('Auth API', () => {
  beforeAll(async () => {
    await connectMongo();
    await connectRedis();
    await User.deleteMany({});
  });

  afterAll(async () => {
    await User.deleteMany({});
    const redis = getRedis();
    await redis.flushdb();
    await mongoose.connection.close();
    await redis.quit();
  });

  const testOrg = 'org_test_123';
  const testUser = {
    email: 'test@example.com',
    password: 'password123',
    name: 'Test User',
    role: 'student' as const,
    organizationId: testOrg,
  };

  it('should register a new user', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send(testUser)
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.user.email).toBe(testUser.email);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
  });

  it('should reject duplicate email in same organization', async () => {
    await request(app)
      .post('/api/v1/auth/register')
      .send(testUser)
      .expect(409);
  });

  it('should allow same email in different organization', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ ...testUser, organizationId: 'org_test_456' })
      .expect(201);

    expect(res.body.success).toBe(true);
  });

  it('should login with valid credentials', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: testUser.email,
        password: testUser.password,
        organizationId: testOrg,
      })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
  });

  it('should reject invalid password', async () => {
    await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: testUser.email,
        password: 'wrongpassword',
        organizationId: testOrg,
      })
      .expect(401);
  });

  it('should refresh access token', async () => {
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: testUser.email,
        password: testUser.password,
        organizationId: testOrg,
      });

    const refreshRes = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: loginRes.body.refreshToken })
      .expect(200);

    expect(refreshRes.body.success).toBe(true);
    expect(refreshRes.body.accessToken).toBeDefined();
  });

  it('should logout and invalidate refresh token', async () => {
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: testUser.email,
        password: testUser.password,
        organizationId: testOrg,
      });

    await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${loginRes.body.accessToken}`)
      .expect(200);

    await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: loginRes.body.refreshToken })
      .expect(401);
  });
});
