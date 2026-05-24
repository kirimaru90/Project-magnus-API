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
import { TerminalsModule } from '../src/terminals/terminals.module';
import { User, UserSchema } from '../src/users/schemas/user.schema';
import {
  Campaign,
  CampaignSchema,
} from '../src/campaigns/schemas/campaign.schema';
import configuration from '../src/config/configuration';

describe('ConfigurationModule (e2e)', () => {
  let app: NestFastifyApplication;
  let userModel: Model<User>;
  let campaignModel: Model<Campaign>;
  let adminToken: string;
  let playerToken: string;
  let player2Token: string;
  let campaignId: string;
  let privateCampaignId: string;

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
        TerminalsModule,
      ],
    }).compile();

    app = await createTestApp(module);
    userModel = module.get(getModelToken(User.name));
    campaignModel = module.get(getModelToken(Campaign.name));

    const hash = await bcrypt.hash('pass', 12);
    await userModel.create({
      username: 'admin',
      passwordHash: hash,
      role: 'admin',
    });
    await userModel.create({
      username: 'player',
      passwordHash: hash,
      role: 'player',
    });
    await userModel.create({
      username: 'player2',
      passwordHash: hash,
      role: 'player',
    });

    const al = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'admin', password: 'pass' },
    });
    adminToken = (JSON.parse(al.body) as { accessToken: string }).accessToken;

    const pl = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'player', password: 'pass' },
    });
    playerToken = (JSON.parse(pl.body) as { accessToken: string }).accessToken;

    const pl2 = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'player2', password: 'pass' },
    });
    player2Token = (JSON.parse(pl2.body) as { accessToken: string })
      .accessToken;

    const campRes = await app.inject({
      method: 'POST',
      url: '/campaigns',
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { name: 'ConfigCampaign', isActive: true, isPublic: true },
    });
    campaignId = (JSON.parse(campRes.body) as { id: string }).id;

    const privRes = await app.inject({
      method: 'POST',
      url: '/campaigns',
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { name: 'PrivateCampaign', isActive: true, isPublic: false },
    });
    privateCampaignId = (JSON.parse(privRes.body) as { id: string }).id;

    const playerDoc = await userModel.findOne({ username: 'player' }).lean();
    await app.inject({
      method: 'POST',
      url: `/campaigns/${campaignId}/players`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { playerId: String(playerDoc!._id) },
    });
  }, 60000);

  afterAll(async () => {
    await app.close();
    await stopMongoMemoryServer();
  });

  // 6.1 New campaign and new user report configuration == {}
  it('6.1a new campaign has empty configuration', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/campaigns/${campaignId}/configuration`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({});
  });

  it('6.1b new user has empty configuration', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/users/me/configuration',
      headers: { Authorization: `Bearer ${playerToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({});
  });

  // 6.2 Admin PUT replaces terminal; sibling domains preserved; empty body resets
  it('6.2a admin PUT replaces configuration.terminal', async () => {
    const putRes = await app.inject({
      method: 'PUT',
      url: `/campaigns/${campaignId}/configuration/terminal`,
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json',
      },
      payload: { phosphorColor: 'amber' },
    });
    expect(putRes.statusCode).toBe(200);

    const doc = await campaignModel.findById(campaignId).lean();
    expect(doc!.configuration.terminal).toEqual({
      phosphorColor: 'amber',
    });
  });

  it('6.2b sibling domains preserved', async () => {
    await campaignModel.findByIdAndUpdate(campaignId, {
      $set: { 'configuration.audio': { bus: 2 } },
    });

    const putRes = await app.inject({
      method: 'PUT',
      url: `/campaigns/${campaignId}/configuration/terminal`,
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json',
      },
      payload: { phosphorColor: 'green' },
    });
    expect(putRes.statusCode).toBe(200);
    const body = JSON.parse(putRes.body) as Record<string, unknown>;
    expect((body.terminal as Record<string, unknown>).phosphorColor).toBe(
      'green',
    );
    expect(body.audio).toEqual({ bus: 2 });
  });

  it('6.2c empty body resets terminal domain to {}', async () => {
    const putRes = await app.inject({
      method: 'PUT',
      url: `/campaigns/${campaignId}/configuration/terminal`,
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json',
      },
      payload: {},
    });
    expect(putRes.statusCode).toBe(200);
    const body = JSON.parse(putRes.body) as Record<string, unknown>;
    expect(body.terminal).toEqual({});
  });

  // 6.3 Non-admin PUT → 403 (authenticated) / 401 (anonymous)
  it('6.3a player PUT to campaign config → 403', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/campaigns/${campaignId}/configuration/terminal`,
      headers: {
        Authorization: `Bearer ${playerToken}`,
        'content-type': 'application/json',
      },
      payload: { phosphorColor: 'white' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('6.3b anonymous PUT to campaign config → 401', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/campaigns/${campaignId}/configuration/terminal`,
      payload: { phosphorColor: 'white' },
    });
    expect(res.statusCode).toBe(401);
  });

  // 6.4 Campaign config reads honor access rules
  it('6.4a player assigned to campaign → 200', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/campaigns/${campaignId}/configuration`,
      headers: { Authorization: `Bearer ${playerToken}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('6.4b anonymous on private campaign → 404', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/campaigns/${privateCampaignId}/configuration`,
    });
    expect(res.statusCode).toBe(404);
  });

  // 6.5 Authenticated user GET/PUT /users/me/configuration; anonymous → 401
  it('6.5a authenticated user PUT own configuration', async () => {
    const putRes = await app.inject({
      method: 'PUT',
      url: '/users/me/configuration/terminal',
      headers: {
        Authorization: `Bearer ${playerToken}`,
        'content-type': 'application/json',
      },
      payload: { soundEnabled: false },
    });
    expect(putRes.statusCode).toBe(200);

    const getRes = await app.inject({
      method: 'GET',
      url: '/users/me/configuration',
      headers: { Authorization: `Bearer ${playerToken}` },
    });
    expect(JSON.parse(getRes.body)).toEqual({
      terminal: { soundEnabled: false },
    });
  });

  it('6.5b anonymous → 401 on GET /users/me/configuration', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/users/me/configuration',
    });
    expect(res.statusCode).toBe(401);
  });

  it('6.5c anonymous → 401 on PUT /users/me/configuration/terminal', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/users/me/configuration/terminal',
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it('6.5d user configurations are isolated per user', async () => {
    await app.inject({
      method: 'PUT',
      url: '/users/me/configuration/terminal',
      headers: {
        Authorization: `Bearer ${player2Token}`,
        'content-type': 'application/json',
      },
      payload: { phosphorColor: 'white' },
    });

    const res1 = await app.inject({
      method: 'GET',
      url: '/users/me/configuration',
      headers: { Authorization: `Bearer ${playerToken}` },
    });
    const res2 = await app.inject({
      method: 'GET',
      url: '/users/me/configuration',
      headers: { Authorization: `Bearer ${player2Token}` },
    });

    const config1 = JSON.parse(res1.body) as Record<string, unknown>;
    const config2 = JSON.parse(res2.body) as Record<string, unknown>;
    expect((config1.terminal as Record<string, unknown>).soundEnabled).toBe(
      false,
    );
    expect((config2.terminal as Record<string, unknown>).phosphorColor).toBe(
      'white',
    );
    expect(
      (config1.terminal as Record<string, unknown>).phosphorColor,
    ).toBeUndefined();
  });

  // 6.6 GET /campaigns/:id/configuration merge behaviour
  it('6.6a user layer overrides campaign layer', async () => {
    await app.inject({
      method: 'PUT',
      url: `/campaigns/${campaignId}/configuration/terminal`,
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json',
      },
      payload: { phosphorColor: 'amber', soundEnabled: true },
    });
    await app.inject({
      method: 'PUT',
      url: '/users/me/configuration/terminal',
      headers: {
        Authorization: `Bearer ${playerToken}`,
        'content-type': 'application/json',
      },
      payload: { soundEnabled: false },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/campaigns/${campaignId}/configuration`,
      headers: { Authorization: `Bearer ${playerToken}` },
    });
    const body = JSON.parse(res.body) as Record<string, unknown>;
    const terminal = body.terminal as Record<string, unknown>;
    expect(terminal.phosphorColor).toBe('amber');
    expect(terminal.soundEnabled).toBe(false);
  });

  it('6.6b nested objects merge key-by-key', async () => {
    await app.inject({
      method: 'PUT',
      url: `/campaigns/${campaignId}/configuration/terminal`,
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json',
      },
      payload: { crtWave: { speed: 0.6, count: 7, vignetteStrength: 1.0 } },
    });
    await app.inject({
      method: 'PUT',
      url: '/users/me/configuration/terminal',
      headers: {
        Authorization: `Bearer ${playerToken}`,
        'content-type': 'application/json',
      },
      payload: { crtWave: { speed: 0.9 } },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/campaigns/${campaignId}/configuration`,
      headers: { Authorization: `Bearer ${playerToken}` },
    });
    const terminal = (JSON.parse(res.body) as Record<string, unknown>)
      .terminal as Record<string, unknown>;
    const crtWave = terminal.crtWave as Record<string, unknown>;
    expect(crtWave.speed).toBe(0.9);
    expect(crtWave.count).toBe(7);
    expect(crtWave.vignetteStrength).toBe(1.0);
  });

  it('6.6c anonymous gets campaign layer only', async () => {
    await app.inject({
      method: 'PUT',
      url: `/campaigns/${campaignId}/configuration/terminal`,
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json',
      },
      payload: { phosphorColor: 'amber' },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/campaigns/${campaignId}/configuration`,
    });
    expect(res.statusCode).toBe(200);
    const terminal = (JSON.parse(res.body) as Record<string, unknown>)
      .terminal as Record<string, unknown>;
    expect(terminal.phosphorColor).toBe('amber');
  });

  it('6.6d both layers empty → {}', async () => {
    const campRes = await app.inject({
      method: 'POST',
      url: '/campaigns',
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { name: 'EmptyCamp', isActive: true, isPublic: true },
    });
    const emptyId = (JSON.parse(campRes.body) as { id: string }).id;

    const adminRes = await app.inject({
      method: 'GET',
      url: `/campaigns/${emptyId}/configuration`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(adminRes.statusCode).toBe(200);
    expect(JSON.parse(adminRes.body)).toEqual({});
  });

  // 6.7 Envelope rejections
  it('6.7a non-object body (array) → 400', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/campaigns/${campaignId}/configuration/terminal`,
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json',
      },
      payload: [1, 2, 3],
    });
    expect(res.statusCode).toBe(400);
  });

  it('6.7b depth > 8 → 400', async () => {
    const deepObj: Record<string, unknown> = {};
    let cursor: Record<string, unknown> = deepObj;
    for (let i = 0; i < 9; i++) {
      cursor.nested = {};
      cursor = cursor.nested as Record<string, unknown>;
    }

    const res = await app.inject({
      method: 'PUT',
      url: `/campaigns/${campaignId}/configuration/terminal`,
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json',
      },
      payload: deepObj,
    });
    expect(res.statusCode).toBe(400);
  });

  it('6.7c oversized body → 400', async () => {
    const big: Record<string, unknown> = {};
    big.data = 'x'.repeat(17 * 1024);

    const res = await app.inject({
      method: 'PUT',
      url: `/campaigns/${campaignId}/configuration/terminal`,
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json',
      },
      payload: big,
    });
    expect(res.statusCode).toBe(400);
  });

  // 6.8 Existing gameplay endpoints contain no configuration field
  it('6.8a GET /campaigns/:id has no configuration field', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/campaigns/${campaignId}`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(body).not.toHaveProperty('configuration');
  });

  it('6.8b GET /campaigns has no configuration field', async () => {
    const res = await app.inject({ method: 'GET', url: '/campaigns' });
    const body = JSON.parse(res.body) as Record<string, unknown>[];
    for (const c of body) {
      expect(c).not.toHaveProperty('configuration');
    }
  });

  it('6.8c GET /auth/me has no configuration field', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { Authorization: `Bearer ${playerToken}` },
    });
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(body).not.toHaveProperty('configuration');
  });
});
