import { Test } from '@nestjs/testing';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
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
  FictionalUser,
  FictionalUserSchema,
} from '../src/terminals/schemas/fictional-user.schema';
import {
  Campaign,
  CampaignSchema,
} from '../src/campaigns/schemas/campaign.schema';
import configuration from '../src/config/configuration';

describe('TerminalsModule (e2e)', () => {
  let app: NestFastifyApplication;
  let adminToken: string;
  let campaignId: string;
  let fictionalUserModel: Model<FictionalUser>;

  const contentWithLogin = {
    meta: { title: 'Secret Terminal' },
    state: { local: { seen: { type: 'boolean', default: false } }, global: {} },
    login: { users: [{ username: 'robco_user', password: 'supersecret' }] },
    nodes: { start: { text: 'Access restricted', choices: [] } },
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
          { name: FictionalUser.name, schema: FictionalUserSchema },
        ]),
        AuthModule,
        UsersModule,
        CampaignsModule,
        TerminalsModule,
      ],
    }).compile();
    app = await createTestApp(module);
    fictionalUserModel = module.get(getModelToken(FictionalUser.name));

    const userModel: Model<User> = module.get(getModelToken(User.name));
    const db = userModel.db.db;
    for (const col of ['users', 'campaigns', 'terminals', 'fictionalusers']) {
      await db.collection(col).deleteMany({});
    }
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

    const cr = await app.inject({
      method: 'POST',
      url: '/campaigns',
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { name: 'C1', isActive: true, isPublic: true },
    });
    campaignId = JSON.parse(cr.body).id;
  });

  afterAll(async () => {
    await app.close();
    await stopMongoMemoryServer();
  });

  it('create strips login.users from stored content', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/campaigns/${campaignId}/terminals`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: contentWithLogin,
    });
    expect(res.statusCode).toBe(201);
    const { id } = JSON.parse(res.body);

    const fictUsers = await fictionalUserModel
      .find({ terminalId: new Types.ObjectId(id) })
      .lean();
    expect(fictUsers).toHaveLength(1);
    expect(fictUsers[0].username).toBe('robco_user');

    const detail = await app.inject({
      method: 'GET',
      url: `/terminals/${id}`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const body = JSON.parse(detail.body);
    const loginUsers = (
      body.content?.login as { users?: unknown[] } | undefined
    )?.users;
    expect(!loginUsers || loginUsers.length === 0).toBe(true);
  });

  it('load excludes fictional credentials', async () => {
    const cr = await app.inject({
      method: 'POST',
      url: `/campaigns/${campaignId}/terminals`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: contentWithLogin,
    });
    const { id } = JSON.parse(cr.body);
    const res = await app.inject({
      method: 'GET',
      url: `/terminals/${id}/load`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const body = JSON.parse(res.body);
    const loginBlock = body.content?.login as
      | { users?: { password?: unknown }[] }
      | undefined;
    const passwords =
      loginBlock?.users?.map((u) => u.password).filter(Boolean) ?? [];
    expect(passwords).toHaveLength(0);
  });

  it('non-admin GET /terminals/:id has no fictionalUsers field', async () => {
    const userModel: Model<User> = app.get(getModelToken(User.name));
    const hash = await bcrypt.hash('pass', 12);
    await userModel.create({
      username: 'player99',
      passwordHash: hash,
      role: 'player',
    });
    const pl = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'player99', password: 'pass' },
    });
    const playerToken = JSON.parse(pl.body).accessToken;

    const cr2 = await app.inject({
      method: 'POST',
      url: `/campaigns/${campaignId}/terminals`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: contentWithLogin,
    });
    const { id } = JSON.parse(cr2.body);

    const res = await app.inject({
      method: 'GET',
      url: `/terminals/${id}`,
      headers: { Authorization: `Bearer ${playerToken}` },
    });
    expect(JSON.parse(res.body).fictionalUsers).toBeUndefined();
  });

  it('update preserves live state value', async () => {
    const cr = await app.inject({
      method: 'POST',
      url: `/campaigns/${campaignId}/terminals`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: {
        meta: { title: 'T' },
        state: { local: { x: { type: 'number', default: 0 } }, global: {} },
        nodes: { start: { text: '', choices: [] } },
      },
    });
    const { id } = JSON.parse(cr.body);

    await app.inject({
      method: 'POST',
      url: `/terminals/${id}/state/mutate`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { mutations: [{ key: 'local.x', op: 'set', value: 7 }] },
    });

    await app.inject({
      method: 'PUT',
      url: `/terminals/${id}`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: {
        meta: { title: 'T-updated' },
        state: {
          local: {
            x: { type: 'number', default: 0 },
            y: { type: 'boolean', default: false },
          },
          global: {},
        },
        nodes: { start: { text: '', choices: [] } },
      },
    });

    const stateRes = await app.inject({
      method: 'GET',
      url: `/terminals/${id}/state`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const state = JSON.parse(stateRes.body);
    expect(state.x).toBe(7);
    expect(state.y).toBe(false);
  });

  it('round-trip export → import', async () => {
    const cr = await app.inject({
      method: 'POST',
      url: `/campaigns/${campaignId}/terminals`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: {
        ...contentWithLogin,
        meta: { ...contentWithLogin.meta, hiddenId: 'secret-export' },
      },
    });
    const { id } = JSON.parse(cr.body);

    const exportRes = await app.inject({
      method: 'POST',
      url: `/terminals/${id}/export`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const exported = JSON.parse(exportRes.body);
    expect(
      (exported.login?.users as { username: string }[] | undefined)?.[0]
        .username,
    ).toBe('robco_user');
    expect(exported.meta).toHaveProperty('hiddenId', 'secret-export');
    expect(exported.meta).not.toHaveProperty('id');

    // Import into a fresh campaign to avoid hiddenId uniqueness conflict with the source terminal
    const campRes = await app.inject({
      method: 'POST',
      url: '/campaigns',
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { name: 'ImportTarget', isActive: true, isPublic: true },
    });
    const importCampaignId = JSON.parse(campRes.body).id;
    const importRes = await app.inject({
      method: 'POST',
      url: `/campaigns/${importCampaignId}/terminals/import`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: exported,
    });
    expect(importRes.statusCode).toBe(201);
  });

  it('POST with content.meta.id is rejected with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/campaigns/${campaignId}/terminals`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: {
        meta: { title: 'T', id: 'client-supplied-id' },
        state: { local: {}, global: {} },
        nodes: { start: { text: '', choices: [] } },
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /terminals/:id injects content.meta.id == top-level id and preserves hiddenId', async () => {
    const cr = await app.inject({
      method: 'POST',
      url: `/campaigns/${campaignId}/terminals`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: {
        meta: { title: 'T', hiddenId: 'inject-detail' },
        state: { local: {}, global: {} },
        nodes: { start: { text: '', choices: [] } },
      },
    });
    const { id } = JSON.parse(cr.body);

    const detail = await app.inject({
      method: 'GET',
      url: `/terminals/${id}`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const detailBody = JSON.parse(detail.body);
    expect(detailBody.id).toBe(id);
    expect(detailBody.content.meta.id).toBe(id);
    expect(detailBody.content.meta.hiddenId).toBe('inject-detail');

    const load = await app.inject({
      method: 'GET',
      url: `/terminals/${id}/load`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const loadBody = JSON.parse(load.body);
    expect(loadBody.content.meta.id).toBe(id);
    expect(loadBody.content.meta.hiddenId).toBe('inject-detail');
  });

  it('fictional login validates plaintext password', async () => {
    const cr = await app.inject({
      method: 'POST',
      url: `/campaigns/${campaignId}/terminals`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: contentWithLogin,
    });
    const { id } = JSON.parse(cr.body);

    const ok = await app.inject({
      method: 'POST',
      url: `/terminals/${id}/fictional-login`,
      payload: { username: 'robco_user', password: 'supersecret' },
    });
    expect(ok.statusCode).toBe(200);
    expect(JSON.parse(ok.body).ok).toBe(true);

    const fail = await app.inject({
      method: 'POST',
      url: `/terminals/${id}/fictional-login`,
      payload: { username: 'robco_user', password: 'wrong' },
    });
    expect(fail.statusCode).toBe(401);
  });

  describe('by-hidden-id slug lookup', () => {
    let privateCampaignId: string;
    let campaign2Id: string;

    const basePayload = (hiddenId: string, pub?: boolean) => ({
      meta: {
        title: 'T',
        hiddenId,
        ...(pub !== undefined ? { public: pub } : {}),
      },
      state: { local: {}, global: {} },
      nodes: { start: { text: '', choices: [] } },
    });

    beforeAll(async () => {
      const cr1 = await app.inject({
        method: 'POST',
        url: '/campaigns',
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: { name: 'Private', isActive: false, isPublic: false },
      });
      privateCampaignId = JSON.parse(cr1.body).id;

      const cr2 = await app.inject({
        method: 'POST',
        url: '/campaigns',
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: { name: 'C2', isActive: true, isPublic: true },
      });
      campaign2Id = JSON.parse(cr2.body).id;
    });

    it('4.1 authorized caller resolves non-public terminal by hiddenId → 200, with injected meta.id', async () => {
      const cr = await app.inject({
        method: 'POST',
        url: `/campaigns/${campaignId}/terminals`,
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: basePayload('lookup-hidden', false),
      });
      const { id: terminalId } = JSON.parse(cr.body);

      const res = await app.inject({
        method: 'GET',
        url: `/campaigns/${campaignId}/terminals/by-hidden-id/lookup-hidden`,
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body).toHaveProperty('content');
      expect(body).toHaveProperty('localState');
      expect(body).toHaveProperty('globalState');
      expect(body.content.meta.id).toBe(terminalId);
      expect(body.content.meta.hiddenId).toBe('lookup-hidden');
    });

    it('4.2 meta.public === true → 404', async () => {
      await app.inject({
        method: 'POST',
        url: `/campaigns/${campaignId}/terminals`,
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: basePayload('lookup-public', true),
      });
      const res = await app.inject({
        method: 'GET',
        url: `/campaigns/${campaignId}/terminals/by-hidden-id/lookup-public`,
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it('4.3 absent meta.public treated as non-public → 200', async () => {
      await app.inject({
        method: 'POST',
        url: `/campaigns/${campaignId}/terminals`,
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: basePayload('lookup-no-flag'),
      });
      const res = await app.inject({
        method: 'GET',
        url: `/campaigns/${campaignId}/terminals/by-hidden-id/lookup-no-flag`,
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.statusCode).toBe(200);
    });

    it('4.4 unknown hiddenId → 404', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/campaigns/${campaignId}/terminals/by-hidden-id/does-not-exist`,
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it('4.5 anonymous caller on private campaign → 404', async () => {
      await app.inject({
        method: 'POST',
        url: `/campaigns/${privateCampaignId}/terminals`,
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: basePayload('vault-101'),
      });
      const res = await app.inject({
        method: 'GET',
        url: `/campaigns/${privateCampaignId}/terminals/by-hidden-id/vault-101`,
      });
      expect(res.statusCode).toBe(404);
    });

    it('4.6 duplicate hiddenId on create within same campaign → 409', async () => {
      const payload = basePayload('dup-test');
      const first = await app.inject({
        method: 'POST',
        url: `/campaigns/${campaignId}/terminals`,
        headers: { Authorization: `Bearer ${adminToken}` },
        payload,
      });
      expect(first.statusCode).toBe(201);
      const second = await app.inject({
        method: 'POST',
        url: `/campaigns/${campaignId}/terminals`,
        headers: { Authorization: `Bearer ${adminToken}` },
        payload,
      });
      expect(second.statusCode).toBe(409);
    });

    it('4.7 duplicate hiddenId on import within same campaign → 409', async () => {
      const payload = basePayload('dup-import');
      const first = await app.inject({
        method: 'POST',
        url: `/campaigns/${campaignId}/terminals/import`,
        headers: { Authorization: `Bearer ${adminToken}` },
        payload,
      });
      expect(first.statusCode).toBe(201);
      const second = await app.inject({
        method: 'POST',
        url: `/campaigns/${campaignId}/terminals/import`,
        headers: { Authorization: `Bearer ${adminToken}` },
        payload,
      });
      expect(second.statusCode).toBe(409);
    });

    it('4.7a multiple terminals without hiddenId allowed in same campaign → 201/201', async () => {
      const noSlug = {
        meta: { title: 'no-slug-1' },
        state: { local: {}, global: {} },
        nodes: { start: { text: '', choices: [] } },
      };
      const r1 = await app.inject({
        method: 'POST',
        url: `/campaigns/${campaignId}/terminals`,
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: noSlug,
      });
      expect(r1.statusCode).toBe(201);
      const r2 = await app.inject({
        method: 'POST',
        url: `/campaigns/${campaignId}/terminals`,
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: { ...noSlug, meta: { title: 'no-slug-2' } },
      });
      expect(r2.statusCode).toBe(201);
    });

    it('4.7b terminal without hiddenId still gets meta.id injected; meta.hiddenId absent', async () => {
      const cr = await app.inject({
        method: 'POST',
        url: `/campaigns/${campaignId}/terminals`,
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: {
          meta: { title: 'no-slug-detail' },
          state: { local: {}, global: {} },
          nodes: { start: { text: '', choices: [] } },
        },
      });
      const { id } = JSON.parse(cr.body);

      const detail = await app.inject({
        method: 'GET',
        url: `/terminals/${id}`,
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const detailBody = JSON.parse(detail.body);
      expect(detailBody.content.meta.id).toBe(id);
      expect(detailBody.content.meta.hiddenId).toBeUndefined();

      const load = await app.inject({
        method: 'GET',
        url: `/terminals/${id}/load`,
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const loadBody = JSON.parse(load.body);
      expect(loadBody.content.meta.id).toBe(id);
      expect(loadBody.content.meta.hiddenId).toBeUndefined();
    });

    it('4.8 same hiddenId allowed across different campaigns → 201', async () => {
      const payload = basePayload('cross-camp');
      const r1 = await app.inject({
        method: 'POST',
        url: `/campaigns/${campaignId}/terminals`,
        headers: { Authorization: `Bearer ${adminToken}` },
        payload,
      });
      expect(r1.statusCode).toBe(201);
      const r2 = await app.inject({
        method: 'POST',
        url: `/campaigns/${campaign2Id}/terminals`,
        headers: { Authorization: `Bearer ${adminToken}` },
        payload,
      });
      expect(r2.statusCode).toBe(201);
    });

    it('4.9 duplicate hiddenId on update → 409', async () => {
      const p1 = basePayload('dup-update-a');
      const r1 = await app.inject({
        method: 'POST',
        url: `/campaigns/${campaignId}/terminals`,
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: p1,
      });
      expect(r1.statusCode).toBe(201);

      const r2 = await app.inject({
        method: 'POST',
        url: `/campaigns/${campaignId}/terminals`,
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: basePayload('dup-update-b'),
      });
      expect(r2.statusCode).toBe(201);
      const { id: t2Id } = JSON.parse(r2.body);

      const update = await app.inject({
        method: 'PUT',
        url: `/terminals/${t2Id}`,
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: {
          ...basePayload('dup-update-a'),
          meta: { title: 'T2-updated', hiddenId: 'dup-update-a' },
        },
      });
      expect(update.statusCode).toBe(409);
    });
  });

  describe('state variable declaration validation', () => {
    const withEnumNoValues = {
      meta: { title: 'Bad Enum' },
      state: { local: { mood: { type: 'enum', default: 'calm' } } },
      nodes: {},
    };

    const withEnumAndValues = {
      meta: { title: 'Good Enum' },
      state: {
        local: {
          mood: { type: 'enum', values: ['calm', 'panicked'], default: 'calm' },
        },
      },
      nodes: {},
    };

    const withInvalidType = {
      meta: { title: 'Bad Type' },
      state: { local: { x: { type: 'date', default: null } } },
      nodes: {},
    };

    it('5.1a enum without values → 400 on create', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/campaigns/${campaignId}/terminals`,
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: withEnumNoValues,
      });
      expect(res.statusCode).toBe(400);
    });

    it('5.1b enum without values → 400 on import', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/campaigns/${campaignId}/terminals/import`,
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: withEnumNoValues,
      });
      expect(res.statusCode).toBe(400);
    });

    it('5.1c enum without values → 400 on update', async () => {
      const cr = await app.inject({
        method: 'POST',
        url: `/campaigns/${campaignId}/terminals`,
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: withEnumAndValues,
      });
      expect(cr.statusCode).toBe(201);
      const { id } = JSON.parse(cr.body);

      const res = await app.inject({
        method: 'PUT',
        url: `/terminals/${id}`,
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: withEnumNoValues,
      });
      expect(res.statusCode).toBe(400);
    });

    it('5.1d enum with non-empty values → 201', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/campaigns/${campaignId}/terminals`,
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: withEnumAndValues,
      });
      expect(res.statusCode).toBe(201);
    });

    it('5.1e invalid type → 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/campaigns/${campaignId}/terminals`,
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: withInvalidType,
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('optional / partial state', () => {
    it('5.3a create with no state block → 201, local state = {}', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/campaigns/${campaignId}/terminals`,
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: { meta: { title: 'No State' }, nodes: {} },
      });
      expect(res.statusCode).toBe(201);
      const { id } = JSON.parse(res.body);

      const stateRes = await app.inject({
        method: 'GET',
        url: `/terminals/${id}/state`,
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(stateRes.statusCode).toBe(200);
      expect(JSON.parse(stateRes.body)).toEqual({});
    });

    it('5.3b create with only state.local → 201', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/campaigns/${campaignId}/terminals`,
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: {
          meta: { title: 'Local Only' },
          state: { local: { foo: { type: 'boolean', default: false } } },
          nodes: {},
        },
      });
      expect(res.statusCode).toBe(201);
    });

    it('5.3c create with only state.global → 201, local state = {}', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/campaigns/${campaignId}/terminals`,
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: {
          meta: { title: 'Global Only' },
          state: { global: { omega: { type: 'number', default: 0 } } },
          nodes: {},
        },
      });
      expect(res.statusCode).toBe(201);
      const { id } = JSON.parse(res.body);

      const stateRes = await app.inject({
        method: 'GET',
        url: `/terminals/${id}/state`,
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(JSON.parse(stateRes.body)).toEqual({});
    });

    it('5.3d export → import round-trip of a stateless terminal succeeds', async () => {
      const cr = await app.inject({
        method: 'POST',
        url: `/campaigns/${campaignId}/terminals`,
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: { meta: { title: 'Stateless' }, nodes: { s: { text: 'hi' } } },
      });
      expect(cr.statusCode).toBe(201);
      const { id } = JSON.parse(cr.body);

      const exportRes = await app.inject({
        method: 'POST',
        url: `/terminals/${id}/export`,
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(exportRes.statusCode).toBe(201);
      const exported = JSON.parse(exportRes.body);

      const campRes = await app.inject({
        method: 'POST',
        url: '/campaigns',
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'StatelessImportTarget',
          isActive: true,
          isPublic: true,
        },
      });
      const importCampaignId = JSON.parse(campRes.body).id;

      const importRes = await app.inject({
        method: 'POST',
        url: `/campaigns/${importCampaignId}/terminals/import`,
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: exported,
      });
      expect(importRes.statusCode).toBe(201);
    });
  });
});

describe('Terminal viewCount (e2e)', () => {
  async function bootstrap(countAdminViews: boolean) {
    process.env.TERMINAL_COUNT_ADMIN_VIEWS = countAdminViews ? 'true' : 'false';

    const uri = await startMongoMemoryServer();
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [configuration],
          ignoreEnvFile: true,
        }),
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

    const app = await createTestApp(module);
    const userModel: Model<User> = module.get(getModelToken(User.name));
    const campaignModel: Model<Campaign> = module.get(
      getModelToken(Campaign.name),
    );

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
    const al = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'admin', password: 'pass' },
    });
    const adminToken = JSON.parse(al.body).accessToken;
    const pl = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'player', password: 'pass' },
    });
    const playerToken = JSON.parse(pl.body).accessToken;

    // Active + public so anonymous and players can load its terminals.
    const campaign = await campaignModel.create({
      name: 'C',
      isActive: true,
      isPublic: true,
    });
    const campaignId = String(campaign._id);

    const t = await app.inject({
      method: 'POST',
      url: `/campaigns/${campaignId}/terminals`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { meta: { title: 'Visible' }, nodes: {} },
    });
    const terminalId = JSON.parse(t.body).id;

    const h = await app.inject({
      method: 'POST',
      url: `/campaigns/${campaignId}/terminals`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: {
        meta: { title: 'Hidden', hiddenId: 'vault-101', public: false },
        nodes: {},
      },
    });
    const hiddenTerminalId = JSON.parse(h.body).id;

    return {
      app,
      adminToken,
      playerToken,
      campaignId,
      terminalId,
      hiddenTerminalId,
    };
  }

  type Ctx = Awaited<ReturnType<typeof bootstrap>>;

  async function viewCountOf(ctx: Ctx, terminalId: string): Promise<number> {
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/campaigns/${ctx.campaignId}/terminals`,
      headers: { Authorization: `Bearer ${ctx.adminToken}` },
    });
    const list = JSON.parse(res.body) as { id: string; viewCount: number }[];
    return list.find((x) => x.id === terminalId)!.viewCount;
  }

  describe('admin views NOT counted (flag false / default)', () => {
    let ctx: Ctx;
    beforeAll(async () => {
      ctx = await bootstrap(false);
    });
    afterAll(async () => {
      await ctx.app.close();
      await stopMongoMemoryServer();
    });

    it('new terminal reports viewCount 0 in the list', async () => {
      expect(await viewCountOf(ctx, ctx.terminalId)).toBe(0);
      expect(await viewCountOf(ctx, ctx.hiddenTerminalId)).toBe(0);
    });

    it('player load by id increments viewCount', async () => {
      const before = await viewCountOf(ctx, ctx.terminalId);
      const res = await ctx.app.inject({
        method: 'GET',
        url: `/terminals/${ctx.terminalId}/load`,
        headers: { Authorization: `Bearer ${ctx.playerToken}` },
      });
      expect(res.statusCode).toBe(200);
      expect(await viewCountOf(ctx, ctx.terminalId)).toBe(before + 1);
    });

    it('anonymous load by hiddenId increments viewCount', async () => {
      const before = await viewCountOf(ctx, ctx.hiddenTerminalId);
      const res = await ctx.app.inject({
        method: 'GET',
        url: `/campaigns/${ctx.campaignId}/terminals/by-hidden-id/vault-101`,
      });
      expect(res.statusCode).toBe(200);
      expect(await viewCountOf(ctx, ctx.hiddenTerminalId)).toBe(before + 1);
    });

    it('admin load by id does NOT increment when flag is false', async () => {
      const before = await viewCountOf(ctx, ctx.terminalId);
      const res = await ctx.app.inject({
        method: 'GET',
        url: `/terminals/${ctx.terminalId}/load`,
        headers: { Authorization: `Bearer ${ctx.adminToken}` },
      });
      expect(res.statusCode).toBe(200);
      expect(await viewCountOf(ctx, ctx.terminalId)).toBe(before);
    });

    it('admin load by hiddenId does NOT increment when flag is false', async () => {
      const before = await viewCountOf(ctx, ctx.hiddenTerminalId);
      const res = await ctx.app.inject({
        method: 'GET',
        url: `/campaigns/${ctx.campaignId}/terminals/by-hidden-id/vault-101`,
        headers: { Authorization: `Bearer ${ctx.adminToken}` },
      });
      expect(res.statusCode).toBe(200);
      expect(await viewCountOf(ctx, ctx.hiddenTerminalId)).toBe(before);
    });

    it('GET /terminals/:id detail does NOT increment viewCount', async () => {
      const before = await viewCountOf(ctx, ctx.terminalId);
      const res = await ctx.app.inject({
        method: 'GET',
        url: `/terminals/${ctx.terminalId}`,
        headers: { Authorization: `Bearer ${ctx.playerToken}` },
      });
      expect(res.statusCode).toBe(200);
      expect(await viewCountOf(ctx, ctx.terminalId)).toBe(before);
    });
  });

  describe('admin views counted (flag true)', () => {
    let ctx: Ctx;
    beforeAll(async () => {
      ctx = await bootstrap(true);
    });
    afterAll(async () => {
      await ctx.app.close();
      await stopMongoMemoryServer();
      delete process.env.TERMINAL_COUNT_ADMIN_VIEWS;
    });

    it('admin load by id increments when flag is true', async () => {
      const before = await viewCountOf(ctx, ctx.terminalId);
      const res = await ctx.app.inject({
        method: 'GET',
        url: `/terminals/${ctx.terminalId}/load`,
        headers: { Authorization: `Bearer ${ctx.adminToken}` },
      });
      expect(res.statusCode).toBe(200);
      expect(await viewCountOf(ctx, ctx.terminalId)).toBe(before + 1);
    });

    it('admin load by hiddenId increments when flag is true', async () => {
      const before = await viewCountOf(ctx, ctx.hiddenTerminalId);
      const res = await ctx.app.inject({
        method: 'GET',
        url: `/campaigns/${ctx.campaignId}/terminals/by-hidden-id/vault-101`,
        headers: { Authorization: `Bearer ${ctx.adminToken}` },
      });
      expect(res.statusCode).toBe(200);
      expect(await viewCountOf(ctx, ctx.hiddenTerminalId)).toBe(before + 1);
    });
  });
});
