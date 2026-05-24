import { Test } from '@nestjs/testing';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { Types } from 'mongoose';
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
import {
  Terminal,
  TerminalSchema,
} from '../src/terminals/schemas/terminal.schema';
import configuration from '../src/config/configuration';

describe('StateModule (e2e)', () => {
  let app: NestFastifyApplication;
  let adminToken: string;
  let terminalId: string;
  let campaignId: string;

  const baseContent = {
    meta: { title: 'Test Terminal', id: 'test-1', public: true },
    state: {
      local: {
        counter: { type: 'number', default: 0 },
        flag: { type: 'boolean', default: false },
        mood: { type: 'enum', values: ['calm', 'panicked'], default: 'calm' },
      },
      global: {
        activated: { type: 'boolean', default: false },
        tick: { type: 'number', default: 0 },
      },
    },
    nodes: { start: { text: 'Hello', choices: [] } },
  };

  beforeAll(async () => {
    const uri = await startMongoMemoryServer();
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
        mongooseTestModule(uri),
        MongooseModule.forFeature([
          { name: User.name, schema: UserSchema },
          { name: Campaign.name, schema: CampaignSchema },
          { name: Terminal.name, schema: TerminalSchema },
        ]),
        AuthModule,
        UsersModule,
        CampaignsModule,
        TerminalsModule,
      ],
    }).compile();
    app = await createTestApp(module);

    const userModel: Model<User> = module.get(getModelToken(User.name));
    const hash = await bcrypt.hash('pass', 12);
    await userModel.create({
      username: 'admin',
      passwordHash: hash,
      role: 'admin',
    });
    const al = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'admin', password: 'pass' },
    });
    adminToken = JSON.parse(al.body).accessToken;

    const campRes = await app.inject({
      method: 'POST',
      url: '/campaigns',
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { name: 'TestCampaign', isActive: true, isPublic: true },
    });
    campaignId = JSON.parse(campRes.body).id;

    const termRes = await app.inject({
      method: 'POST',
      url: `/campaigns/${campaignId}/terminals`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: baseContent,
    });
    terminalId = JSON.parse(termRes.body).id;
  });

  afterAll(async () => {
    await app.close();
    await stopMongoMemoryServer();
  });

  it('GET /terminals/:id/state → flat state map', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/terminals/${terminalId}/state`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.counter).toBe(0);
    expect(body.flag).toBe(false);
    expect(body.mood).toBe('calm');
  });

  it('POST /terminals/:id/state/mutate → atomic set + increment', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/terminals/${terminalId}/state/mutate`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: {
        mutations: [
          { key: 'local.counter', op: 'increment', by: 3 },
          { key: 'local.flag', op: 'set', value: true },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.state.counter).toBe(3);
    expect(body.state.flag).toBe(true);
  });

  it('toggle boolean', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/terminals/${terminalId}/state/mutate`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { mutations: [{ key: 'local.flag', op: 'toggle' }] },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).state.flag).toBe(false);
  });

  it('type mismatch → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/terminals/${terminalId}/state/mutate`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: {
        mutations: [{ key: 'local.counter', op: 'set', value: 'not-a-number' }],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('invalid enum value → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/terminals/${terminalId}/state/mutate`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: {
        mutations: [{ key: 'local.mood', op: 'set', value: 'furious' }],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('undeclared variable → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/terminals/${terminalId}/state/mutate`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { mutations: [{ key: 'local.ghost', op: 'set', value: true }] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('anonymous mutation on public campaign allowed', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/terminals/${terminalId}/state/mutate`,
      payload: {
        mutations: [{ key: 'local.counter', op: 'increment', by: 1 }],
      },
    });
    expect(res.statusCode).toBe(200);
  });

  it('reset single var → restored to default', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/terminals/${terminalId}/state/counter/reset`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).state.counter).toBe(0);
  });

  it('reset all terminal state', async () => {
    await app.inject({
      method: 'POST',
      url: `/terminals/${terminalId}/state/mutate`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { mutations: [{ key: 'local.counter', op: 'set', value: 99 }] },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/terminals/${terminalId}/state/reset`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).state.counter).toBe(0);
  });

  it('campaign-wide reset resets terminals too', async () => {
    await app.inject({
      method: 'POST',
      url: `/terminals/${terminalId}/state/mutate`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { mutations: [{ key: 'local.counter', op: 'set', value: 42 }] },
    });
    await app.inject({
      method: 'POST',
      url: `/campaigns/${campaignId}/state/reset`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const stateRes = await app.inject({
      method: 'GET',
      url: `/terminals/${terminalId}/state`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(JSON.parse(stateRes.body).counter).toBe(0);
  });

  it('non-admin reset → 403', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/terminals/${terminalId}/state/reset`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('5.4a increment with no by on local → adds exactly 1', async () => {
    const before = await app.inject({
      method: 'GET',
      url: `/terminals/${terminalId}/state`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const beforeVal = JSON.parse(before.body).counter as number;

    const res = await app.inject({
      method: 'POST',
      url: `/terminals/${terminalId}/state/mutate`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { mutations: [{ key: 'local.counter', op: 'increment' }] },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).state.counter).toBe(beforeVal + 1);
  });

  it('5.4b increment with no by on global → adds exactly 1', async () => {
    const before = await app.inject({
      method: 'GET',
      url: `/campaigns/${campaignId}/state`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const beforeVal = JSON.parse(before.body).tick as number;

    const res = await app.inject({
      method: 'POST',
      url: `/campaigns/${campaignId}/state/mutate`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { mutations: [{ key: 'global.tick', op: 'increment' }] },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).state.tick).toBe(beforeVal + 1);
  });
});
