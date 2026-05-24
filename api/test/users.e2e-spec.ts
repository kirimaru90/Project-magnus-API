import { Test } from '@nestjs/testing';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import {
  createTestApp,
  startMongoMemoryServer,
  stopMongoMemoryServer,
  mongooseTestModule,
} from './test-helpers';
import { AuthModule } from '../src/auth/auth.module';
import { UsersModule } from '../src/users/users.module';
import { CampaignsModule } from '../src/campaigns/campaigns.module';
import { User, UserSchema } from '../src/users/schemas/user.schema';
import {
  Campaign,
  CampaignSchema,
} from '../src/campaigns/schemas/campaign.schema';
import configuration from '../src/config/configuration';

describe('UsersModule (e2e)', () => {
  let app: NestFastifyApplication;
  let userModel: Model<User>;
  let adminToken: string;
  let playerToken: string;

  beforeAll(async () => {
    const uri = await startMongoMemoryServer();
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
        mongooseTestModule(uri),
        MongooseModule.forFeature([
          { name: User.name, schema: UserSchema },
          { name: Campaign.name, schema: CampaignSchema },
        ]),
        AuthModule,
        UsersModule,
        CampaignsModule,
      ],
    }).compile();

    app = await createTestApp(module);
    userModel = module.get(getModelToken(User.name));

    const adminHash = await bcrypt.hash('adminpass', 12);
    const playerHash = await bcrypt.hash('playerpass', 12);
    await userModel.create({
      username: 'admin',
      passwordHash: adminHash,
      role: 'admin',
    });
    await userModel.create({
      username: 'player1',
      passwordHash: playerHash,
      role: 'player',
    });

    const adminLogin = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'admin', password: 'adminpass' },
    });
    adminToken = JSON.parse(adminLogin.body).accessToken;

    const playerLogin = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'player1', password: 'playerpass' },
    });
    playerToken = JSON.parse(playerLogin.body).accessToken;
  });

  afterAll(async () => {
    await app.close();
    await stopMongoMemoryServer();
  });

  it('GET /users → 200 for admin', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/users',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body)).toBe(true);
    expect(body.every((u: { passwordHash?: unknown }) => !u.passwordHash)).toBe(
      true,
    );
  });

  it('GET /users → 403 for player', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/users',
      headers: { Authorization: `Bearer ${playerToken}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('GET /users → 401 anonymous', async () => {
    const res = await app.inject({ method: 'GET', url: '/users' });
    expect(res.statusCode).toBe(401);
  });

  it('POST /users → 201 creates user, password hashed', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/users',
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: {
        username: 'newplayer',
        password: 'securepass',
        role: 'player',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.username).toBe('newplayer');
    expect(body.passwordHash).toBeUndefined();
    const stored = await userModel.findOne({ username: 'newplayer' }).lean();
    expect(stored?.passwordHash).toMatch(/^\$2[aby]?\$/);
  });

  it('POST /users → 409 on duplicate username', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/users',
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: {
        username: 'newplayer',
        password: 'anotherpass',
        role: 'player',
      },
    });
    expect(res.statusCode).toBe(409);
  });

  it('POST /users → 400 on invalid role', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/users',
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { username: 'x', password: 'password1', role: 'superadmin' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('DELETE /users/:id → 409 when deleting self', async () => {
    const me = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const { id } = JSON.parse(me.body);
    const res = await app.inject({
      method: 'DELETE',
      url: `/users/${id}`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(409);
  });
});
