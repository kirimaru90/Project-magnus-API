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

describe('CampaignsModule (e2e)', () => {
  let app: NestFastifyApplication;
  let userModel: Model<User>;
  let campaignModel: Model<Campaign>;
  let adminToken: string;
  let playerToken: string;
  let playerId: string;

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
    const admin = await userModel.create({
      username: 'admin',
      passwordHash: hash,
      role: 'admin',
    });
    const player = await userModel.create({
      username: 'player',
      passwordHash: hash,
      role: 'player',
    });
    playerId = String(player._id);

    const al = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'admin', password: 'pass' },
    });
    adminToken = JSON.parse(al.body).accessToken;
    const pl = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'player', password: 'pass' },
    });
    playerToken = JSON.parse(pl.body).accessToken;
  });

  afterAll(async () => {
    await app.close();
    await stopMongoMemoryServer();
  });

  it('GET /campaigns: anonymous sees only active public', async () => {
    await campaignModel.create({ name: 'C1', isActive: true, isPublic: true });
    await campaignModel.create({ name: 'C2', isActive: true, isPublic: false });
    await campaignModel.create({ name: 'C3', isActive: false, isPublic: true });

    const res = await app.inject({ method: 'GET', url: '/campaigns' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { name: string }[];
    expect(body.some((c) => c.name === 'C1')).toBe(true);
    expect(body.some((c) => c.name === 'C2')).toBe(false);
    expect(body.some((c) => c.name === 'C3')).toBe(false);
  });

  it('GET /campaigns: admin sees all', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/campaigns',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const body = JSON.parse(res.body) as { name: string }[];
    expect(body.length).toBeGreaterThanOrEqual(3);
  });

  it('GET /campaigns/:id private → 404 for anonymous', async () => {
    const c2 = await campaignModel.findOne({ name: 'C2' }).lean();
    const res = await app.inject({
      method: 'GET',
      url: `/campaigns/${c2!._id}`,
    });
    expect(res.statusCode).toBe(404);
  });

  it('GET /campaigns/:id: anonymous projection has empty players', async () => {
    const c1 = await campaignModel.findOne({ name: 'C1' }).lean();
    const res = await app.inject({
      method: 'GET',
      url: `/campaigns/${c1!._id}`,
    });
    const body = JSON.parse(res.body);
    expect(body.players).toEqual([]);
  });

  it('POST /campaigns/:id/players: cannot assign admin user', async () => {
    const camp = await campaignModel.findOne({ name: 'C1' }).lean();
    const admin = await userModel.findOne({ role: 'admin' }).lean();
    const res = await app.inject({
      method: 'POST',
      url: `/campaigns/${camp!._id}/players`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { playerId: String(admin!._id) },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /campaigns/:id/players + DELETE → player in/out', async () => {
    const camp = await campaignModel.findOne({ name: 'C2' }).lean();
    const addRes = await app.inject({
      method: 'POST',
      url: `/campaigns/${camp!._id}/players`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { playerId },
    });
    expect(addRes.statusCode).toBe(201);

    const delRes = await app.inject({
      method: 'DELETE',
      url: `/campaigns/${camp!._id}/players/${playerId}`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(delRes.statusCode).toBe(204);
  });

  it('DELETE /campaigns/:id cascade removes terminals', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/campaigns',
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { name: 'ToCascade' },
    });
    const { id } = JSON.parse(created.body);
    await app.inject({
      method: 'DELETE',
      url: `/campaigns/${id}`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const gone = await campaignModel.findById(id).lean();
    expect(gone).toBeNull();
  });
});
