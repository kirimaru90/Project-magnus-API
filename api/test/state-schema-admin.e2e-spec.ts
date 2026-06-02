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
import {
  Terminal,
  TerminalSchema,
} from '../src/terminals/schemas/terminal.schema';
import configuration from '../src/config/configuration';

describe('StateSchemaAdmin (e2e)', () => {
  let app: NestFastifyApplication;
  let adminToken: string;
  let playerToken: string;
  let campaignId: string;
  let terminalId: string;

  const baseContent = {
    meta: { title: 'SchemaTest Terminal', public: true },
    state: {
      local: {
        counter: { type: 'number', default: 0 },
        flag: { type: 'boolean', default: false },
      },
      global: {
        phase: { type: 'enum', values: ['idle', 'active'], default: 'idle' },
        score: { type: 'number', default: 0 },
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
    await userModel.create({
      username: 'player',
      passwordHash: hash,
      role: 'player',
    });

    const alRes = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'admin', password: 'pass' },
    });
    adminToken = JSON.parse(alRes.body).accessToken;

    const plRes = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'player', password: 'pass' },
    });
    playerToken = JSON.parse(plRes.body).accessToken;

    const campRes = await app.inject({
      method: 'POST',
      url: '/campaigns',
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { name: 'SchemaCampaign', isActive: true, isPublic: true },
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

  // --- Terminal schema admin ---

  describe('PATCH /terminals/:id/state/schema', () => {
    it('401 when unauthenticated', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/terminals/${terminalId}/state/schema`,
        payload: {
          ops: [
            {
              action: 'add',
              name: 'x',
              entry: { type: 'boolean', default: false },
            },
          ],
        },
      });
      expect(res.statusCode).toBe(401);
    });

    it('403 when player (non-admin)', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/terminals/${terminalId}/state/schema`,
        headers: { Authorization: `Bearer ${playerToken}` },
        payload: {
          ops: [
            {
              action: 'add',
              name: 'x',
              entry: { type: 'boolean', default: false },
            },
          ],
        },
      });
      expect(res.statusCode).toBe(403);
    });

    it('400 on empty ops', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/terminals/${terminalId}/state/schema`,
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: { ops: [] },
      });
      expect(res.statusCode).toBe(400);
    });

    it('200: add new local variable', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/terminals/${terminalId}/state/schema`,
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: {
          ops: [
            {
              action: 'add',
              name: 'alarm',
              entry: { type: 'boolean', default: false },
            },
          ],
        },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.state).toHaveProperty('alarm', false);
      expect(body.state).toHaveProperty('counter', 0);
    });

    it('200: update local variable resets value to default when value omitted', async () => {
      // First set counter to a non-default value
      await app.inject({
        method: 'POST',
        url: `/terminals/${terminalId}/state/mutate`,
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: {
          mutations: [{ key: 'local.counter', op: 'increment', by: 10 }],
        },
      });

      const res = await app.inject({
        method: 'PATCH',
        url: `/terminals/${terminalId}/state/schema`,
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: {
          ops: [
            {
              action: 'update',
              name: 'counter',
              entry: { type: 'number', default: 0 },
            },
          ],
        },
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).state.counter).toBe(0);
    });

    it('200: delete local variable', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/terminals/${terminalId}/state/schema`,
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: { ops: [{ action: 'delete', name: 'flag' }] },
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).state).not.toHaveProperty('flag');
    });

    it('404 on update/delete of missing variable', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/terminals/${terminalId}/state/schema`,
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: { ops: [{ action: 'delete', name: 'nonexistent' }] },
      });
      expect(res.statusCode).toBe(404);
    });

    it('409 on rename to existing variable', async () => {
      // Add 'extra' first so we can try renaming 'counter' → 'extra'
      await app.inject({
        method: 'PATCH',
        url: `/terminals/${terminalId}/state/schema`,
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: {
          ops: [
            {
              action: 'add',
              name: 'extra',
              entry: { type: 'number', default: 0 },
            },
          ],
        },
      });

      const res = await app.inject({
        method: 'PATCH',
        url: `/terminals/${terminalId}/state/schema`,
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: {
          ops: [
            {
              action: 'update',
              name: 'counter',
              rename: 'extra',
              entry: { type: 'number', default: 0 },
            },
          ],
        },
      });
      expect(res.statusCode).toBe(409);
    });
  });

  // --- Campaign schema admin ---

  describe('PATCH /campaigns/:id/state/schema', () => {
    it('401 when unauthenticated', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/campaigns/${campaignId}/state/schema`,
        payload: {
          ops: [
            {
              action: 'add',
              name: 'x',
              entry: { type: 'boolean', default: false },
            },
          ],
        },
      });
      expect(res.statusCode).toBe(401);
    });

    it('403 when player (non-admin)', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/campaigns/${campaignId}/state/schema`,
        headers: { Authorization: `Bearer ${playerToken}` },
        payload: {
          ops: [
            {
              action: 'add',
              name: 'x',
              entry: { type: 'boolean', default: false },
            },
          ],
        },
      });
      expect(res.statusCode).toBe(403);
    });

    it('400 on empty ops', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/campaigns/${campaignId}/state/schema`,
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: { ops: [] },
      });
      expect(res.statusCode).toBe(400);
    });

    it('200: add new global variable', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/campaigns/${campaignId}/state/schema`,
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: {
          ops: [
            {
              action: 'add',
              name: 'siteOpen',
              entry: { type: 'boolean', default: false },
            },
          ],
        },
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).state).toHaveProperty('siteOpen', false);
    });

    it('200: delete unreferenced global variable', async () => {
      // Add a var that no terminal references
      await app.inject({
        method: 'PATCH',
        url: `/campaigns/${campaignId}/state/schema`,
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: {
          ops: [
            {
              action: 'add',
              name: 'toDelete',
              entry: { type: 'string', default: 'x' },
            },
          ],
        },
      });

      const res = await app.inject({
        method: 'PATCH',
        url: `/campaigns/${campaignId}/state/schema`,
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: { ops: [{ action: 'delete', name: 'toDelete' }] },
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).state).not.toHaveProperty('toDelete');
    });

    it('409: delete referenced global variable', async () => {
      // The terminal has content.state.global.phase → it references 'phase'
      const terminalModel: Model<Terminal> = app.get(
        getModelToken(Terminal.name),
      );
      await terminalModel.findByIdAndUpdate(terminalId, {
        $set: { 'content.state.global.score': 99 },
      });

      const res = await app.inject({
        method: 'PATCH',
        url: `/campaigns/${campaignId}/state/schema`,
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: { ops: [{ action: 'delete', name: 'score' }] },
      });
      expect(res.statusCode).toBe(409);
      const body = JSON.parse(res.body);
      expect(body.conflicts[0].variable).toBe('score');
      expect(body.conflicts[0].referencedBy).toHaveLength(1);
      expect(body.conflicts[0].referencedBy[0].id).toBe(terminalId);

      // Clean up reference
      await terminalModel.findByIdAndUpdate(terminalId, {
        $unset: { 'content.state.global.score': '' },
      });
    });

    it('200: rename rewrites referencing terminal', async () => {
      // Set a reference in terminal's content.state.global.phase
      const terminalModel: Model<Terminal> = app.get(
        getModelToken(Terminal.name),
      );
      await terminalModel.findByIdAndUpdate(terminalId, {
        $set: { 'content.state.global.phase': 'idle' },
      });

      const res = await app.inject({
        method: 'PATCH',
        url: `/campaigns/${campaignId}/state/schema`,
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: {
          ops: [
            {
              action: 'update',
              name: 'phase',
              rename: 'stage',
              entry: {
                type: 'enum',
                values: ['idle', 'active'],
                default: 'idle',
              },
            },
          ],
        },
      });
      expect(res.statusCode).toBe(200);

      // Verify terminal was rewritten
      const updatedTerminal = await terminalModel.findById(terminalId).lean();
      const globalRef = (updatedTerminal!.content as any)?.state?.global;
      expect(globalRef).not.toHaveProperty('phase');
      expect(globalRef).toHaveProperty('stage');

      // Verify campaign schema updated
      expect(JSON.parse(res.body).state).not.toHaveProperty('phase');
      expect(JSON.parse(res.body).state).toHaveProperty('stage');
    });

    it('409: rename blocked when terminal has both from and to keys', async () => {
      const terminalModel: Model<Terminal> = app.get(
        getModelToken(Terminal.name),
      );
      // Set both 'stage' (from previous rename) and add 'score' to content.global
      await terminalModel.findByIdAndUpdate(terminalId, {
        $set: {
          'content.state.global.stage': 'idle',
          'content.state.global.score': 5,
        },
      });

      const res = await app.inject({
        method: 'PATCH',
        url: `/campaigns/${campaignId}/state/schema`,
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: {
          ops: [
            {
              action: 'update',
              name: 'stage',
              rename: 'score',
              entry: {
                type: 'enum',
                values: ['idle', 'active'],
                default: 'idle',
              },
            },
          ],
        },
      });
      expect(res.statusCode).toBe(409);
    });
  });

  // --- Regression: existing mutate/reset unaffected ---

  describe('Regression: existing state endpoints unaffected', () => {
    it('POST /terminals/:id/state/mutate still works after schema admin', async () => {
      // Ensure 'alarm' (added in earlier test) is present and mutable
      const res = await app.inject({
        method: 'POST',
        url: `/terminals/${terminalId}/state/mutate`,
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: {
          mutations: [{ key: 'local.alarm', op: 'set', value: true }],
        },
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).state.alarm).toBe(true);
    });
  });
});
