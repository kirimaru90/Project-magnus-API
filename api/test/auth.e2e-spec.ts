import { Test } from '@nestjs/testing';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ConfigModule } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import {
  createTestApp,
  startMongoMemoryServer,
  stopMongoMemoryServer,
  mongooseTestModule,
} from './test-helpers';
import { AuthModule } from '../src/auth/auth.module';
import { User, UserSchema } from '../src/users/schemas/user.schema';
import { MongooseModule } from '@nestjs/mongoose';
import configuration from '../src/config/configuration';

describe('AuthModule (e2e)', () => {
  let app: NestFastifyApplication;
  let userModel: Model<User>;

  beforeAll(async () => {
    const uri = await startMongoMemoryServer();
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
        mongooseTestModule(uri),
        MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
        AuthModule,
      ],
    }).compile();

    app = await createTestApp(module);
    userModel = module.get(getModelToken(User.name));

    const hash = await bcrypt.hash('password123', 12);
    await userModel.create({
      username: 'admin1',
      passwordHash: hash,
      role: 'admin',
    });
  });

  afterAll(async () => {
    await app.close();
    await stopMongoMemoryServer();
  });

  it('POST /auth/login → 200 with accessToken', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'admin1', password: 'password123' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.accessToken).toBeDefined();
    expect(body.role).toBe('admin');
    expect(body.expiresIn).toBe(86400);
  });

  it('POST /auth/login with wrong password → 401 generic', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'admin1', password: 'wrong' },
    });
    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.message).toBe('Invalid credentials');
  });

  it('POST /auth/login with unknown user → 401 generic (same message)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'nobody', password: 'password123' },
    });
    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.message).toBe('Invalid credentials');
  });

  it('POST /auth/logout → 204 without token', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/logout' });
    expect(res.statusCode).toBe(204);
  });

  it('GET /auth/me without token → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/me' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /auth/me with valid token → 200 with user info', async () => {
    const loginRes = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'admin1', password: 'password123' },
    });
    const { accessToken } = JSON.parse(loginRes.body);
    const res = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.username).toBe('admin1');
    expect(body.role).toBe('admin');
    expect(body.passwordHash).toBeUndefined();
  });
});
