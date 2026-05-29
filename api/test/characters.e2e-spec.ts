import { Test } from '@nestjs/testing';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
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
import { CharactersModule } from '../src/characters/characters.module';
import { User, UserSchema } from '../src/users/schemas/user.schema';
import {
  Campaign,
  CampaignSchema,
} from '../src/campaigns/schemas/campaign.schema';
import configuration from '../src/config/configuration';

/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */

describe('CharactersModule (e2e)', () => {
  let app: NestFastifyApplication;
  let userModel: Model<User>;
  let campaignModel: Model<Campaign>;
  let adminToken: string;
  let playerAToken: string;
  let playerBToken: string;
  let playerAId: string;
  let playerBId: string;
  let campaignId: string;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  // Create a character owned by `userId` (via admin) and return its id.
  async function createCharacter(userId: string, name = 'Dweller') {
    const res = await app.inject({
      method: 'POST',
      url: `/campaigns/${campaignId}/characters`,
      headers: auth(adminToken),
      payload: { name, userId },
    });
    return JSON.parse(res.body).id as string;
  }

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
        CharactersModule,
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
    const playerA = await userModel.create({
      username: 'playerA',
      passwordHash: hash,
      role: 'player',
    });
    const playerB = await userModel.create({
      username: 'playerB',
      passwordHash: hash,
      role: 'player',
    });
    playerAId = String(playerA._id);
    playerBId = String(playerB._id);

    const login = async (username: string) => {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { username, password: 'pass' },
      });
      return JSON.parse(res.body).accessToken as string;
    };
    adminToken = await login('admin');
    playerAToken = await login('playerA');
    playerBToken = await login('playerB');

    // Active campaign with both players as members.
    const camp = await campaignModel.create({
      name: 'Wasteland',
      isActive: true,
      isPublic: false,
      players: [playerA._id, playerB._id],
    });
    campaignId = String(camp._id);
  });

  afterAll(async () => {
    await app.close();
    await stopMongoMemoryServer();
  });

  // --- 8.1 Route registration (Swagger) ---

  it('exposes all 12 character routes in Swagger', () => {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().addBearerAuth().build(),
    );
    const charPaths = Object.entries(doc.paths).filter(([p]) =>
      p.startsWith('/campaigns/{campaignId}/characters'),
    );
    const operationCount = charPaths.reduce(
      (sum, [, item]) =>
        sum +
        ['get', 'post', 'put', 'delete', 'patch'].filter(
          (m) => (item as Record<string, unknown>)[m],
        ).length,
      0,
    );
    expect(operationCount).toBe(12);
  });

  // --- 8.2 Player self-create + read ---

  it('player creates own character, then sees it in list and detail', async () => {
    const created = await app.inject({
      method: 'POST',
      url: `/campaigns/${campaignId}/characters`,
      headers: auth(playerAToken),
      payload: { name: 'Vault Dweller', userId: playerBId }, // body userId ignored
    });
    expect(created.statusCode).toBe(201);
    const body = JSON.parse(created.body);
    expect(body.userId).toBe(playerAId); // inferred from JWT, not body
    const id = body.id as string;

    const list = await app.inject({
      method: 'GET',
      url: `/campaigns/${campaignId}/characters`,
      headers: auth(playerAToken),
    });
    expect(list.statusCode).toBe(200);
    expect(
      (JSON.parse(list.body) as { id: string }[]).some((c) => c.id === id),
    ).toBe(true);

    const detail = await app.inject({
      method: 'GET',
      url: `/campaigns/${campaignId}/characters/${id}`,
      headers: auth(playerAToken),
    });
    expect(detail.statusCode).toBe(200);
    expect(JSON.parse(detail.body).name).toBe('Vault Dweller');
  });

  // --- create RBAC / validation (Decision §5.2) ---

  it('admin must supply userId; unknown member rejected', async () => {
    const noUser = await app.inject({
      method: 'POST',
      url: `/campaigns/${campaignId}/characters`,
      headers: auth(adminToken),
      payload: { name: 'X' },
    });
    expect(noUser.statusCode).toBe(400);

    const nonMember = await app.inject({
      method: 'POST',
      url: `/campaigns/${campaignId}/characters`,
      headers: auth(adminToken),
      payload: { name: 'X', userId: '5f9f1b9b9c9d440000000000' },
    });
    expect(nonMember.statusCode).toBe(400);
  });

  // --- 8.3 Cross-owner isolation ---

  it("player cannot access another player's character (404)", async () => {
    const charB = await createCharacter(playerBId);
    const res = await app.inject({
      method: 'GET',
      url: `/campaigns/${campaignId}/characters/${charB}`,
      headers: auth(playerAToken),
    });
    expect(res.statusCode).toBe(404);
  });

  // --- 8.4 PATCH diffing (perks, nanoid collection) ---

  it('perks: id-less create mints id, id update merges, unknown skipped, deletedIds removes; returns section only', async () => {
    const id = await createCharacter(playerAId);

    // create (id-less → minted)
    const c = await app.inject({
      method: 'PATCH',
      url: `/campaigns/${campaignId}/characters/${id}/perks`,
      headers: auth(adminToken),
      payload: { items: [{ name: 'Bloody Mess' }] },
    });
    expect(c.statusCode).toBe(200);
    const perks = JSON.parse(c.body) as { id: string; name: string }[];
    expect(Array.isArray(perks)).toBe(true); // section only, not full character
    expect(perks).toHaveLength(1);
    const perkId = perks[0].id;
    expect(perkId).toBeTruthy();

    // update by id (merge) + unknown id (skipped)
    const u = await app.inject({
      method: 'PATCH',
      url: `/campaigns/${campaignId}/characters/${id}/perks`,
      headers: auth(adminToken),
      payload: {
        items: [
          { id: perkId, description: 'updated' },
          { id: 'doesnotexist', name: 'Ghost' },
        ],
      },
    });
    const afterUpdate = JSON.parse(u.body) as {
      id: string;
      description?: string;
    }[];
    expect(afterUpdate).toHaveLength(1);
    expect(afterUpdate[0].description).toBe('updated');

    // delete
    const d = await app.inject({
      method: 'PATCH',
      url: `/campaigns/${campaignId}/characters/${id}/perks`,
      headers: auth(adminToken),
      payload: { deletedIds: [perkId] },
    });
    expect(JSON.parse(d.body)).toHaveLength(0);
  });

  // --- 8.5 RBAC field-level whitelist ---

  it('player writes to admin-only sections are silently ignored; player-writable sections apply', async () => {
    const id = await createCharacter(playerAId);

    // special (admin-only) ignored
    const sp = await app.inject({
      method: 'PATCH',
      url: `/campaigns/${campaignId}/characters/${id}/special`,
      headers: auth(playerAToken),
      payload: { strength: 5 },
    });
    expect(sp.statusCode).toBe(200);
    expect(JSON.parse(sp.body).strength).toBe(1);

    // skills (admin-only) ignored
    const sk = await app.inject({
      method: 'PATCH',
      url: `/campaigns/${campaignId}/characters/${id}/skills`,
      headers: auth(playerAToken),
      payload: { items: [{ id: 'lockpick', level: 'expert' }] },
    });
    expect(sk.statusCode).toBe(200);
    expect(JSON.parse(sk.body)).toHaveLength(0);

    // action-points: paCurrent allowed, paMax dropped
    const ap = await app.inject({
      method: 'PATCH',
      url: `/campaigns/${campaignId}/characters/${id}/action-points`,
      headers: auth(playerAToken),
      payload: { paMax: 10, paCurrent: 3 },
    });
    const apBody = JSON.parse(ap.body);
    expect(apBody.paCurrent).toBe(3);
    expect(apBody.paMax).toBeUndefined();

    // resources: caps/scraps allowed, bobbleheads dropped
    const rs = await app.inject({
      method: 'PATCH',
      url: `/campaigns/${campaignId}/characters/${id}/resources`,
      headers: auth(playerAToken),
      payload: { caps: 120, scraps: 8, bobbleheads: 5 },
    });
    const rsBody = JSON.parse(rs.body);
    expect(rsBody.caps).toBe(120);
    expect(rsBody.scraps).toBe(8);
    expect(rsBody.bobbleheads).toBe(0);

    // status: player-writable
    const st = await app.inject({
      method: 'PATCH',
      url: `/campaigns/${campaignId}/characters/${id}/status`,
      headers: auth(playerAToken),
      payload: { criticalState: true },
    });
    expect(JSON.parse(st.body).criticalState).toBe(true);

    // inventory: player-writable
    const inv = await app.inject({
      method: 'PATCH',
      url: `/campaigns/${campaignId}/characters/${id}/inventory`,
      headers: auth(playerAToken),
      payload: { weapons: { items: [{ name: '10mm Pistol' }] } },
    });
    const invBody = JSON.parse(inv.body);
    expect(invBody.weapons).toHaveLength(1);
    expect(invBody.weapons[0].id).toBeTruthy();
  });

  it('admin can write SPECIAL; out-of-range → 400', async () => {
    const id = await createCharacter(playerAId);
    const ok = await app.inject({
      method: 'PATCH',
      url: `/campaigns/${campaignId}/characters/${id}/special`,
      headers: auth(adminToken),
      payload: { strength: 4, luck: 2 },
    });
    const sp = JSON.parse(ok.body);
    expect(sp.strength).toBe(4);
    expect(sp.luck).toBe(2);
    expect(sp.perception).toBe(1);

    const bad = await app.inject({
      method: 'PATCH',
      url: `/campaigns/${campaignId}/characters/${id}/special`,
      headers: auth(adminToken),
      payload: { strength: 9 },
    });
    expect(bad.statusCode).toBe(400);
  });

  // --- 8.6 Skills (static-slug collection) ---

  it('admin attaches/changes/detaches a skill by slug; id-less → 400', async () => {
    const id = await createCharacter(playerAId);

    const attach = await app.inject({
      method: 'PATCH',
      url: `/campaigns/${campaignId}/characters/${id}/skills`,
      headers: auth(adminToken),
      payload: { items: [{ id: 'hacking', level: 'expert' }] },
    });
    let skills = JSON.parse(attach.body) as { id: string; level: string }[];
    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({ id: 'hacking', level: 'expert' });

    const change = await app.inject({
      method: 'PATCH',
      url: `/campaigns/${campaignId}/characters/${id}/skills`,
      headers: auth(adminToken),
      payload: { items: [{ id: 'hacking', level: 'master' }] },
    });
    skills = JSON.parse(change.body);
    expect(skills).toHaveLength(1);
    expect(skills[0].level).toBe('master');

    const detach = await app.inject({
      method: 'PATCH',
      url: `/campaigns/${campaignId}/characters/${id}/skills`,
      headers: auth(adminToken),
      payload: { deletedIds: ['hacking'] },
    });
    expect(JSON.parse(detach.body)).toHaveLength(0);

    const idless = await app.inject({
      method: 'PATCH',
      url: `/campaigns/${campaignId}/characters/${id}/skills`,
      headers: auth(adminToken),
      payload: { items: [{ level: 'expert' }] },
    });
    expect(idless.statusCode).toBe(400);
  });

  // --- 8.7 Soft-delete ---

  it('DELETE soft-deletes: gone from list and detail 404', async () => {
    const id = await createCharacter(playerAId, 'ToDelete');

    const del = await app.inject({
      method: 'DELETE',
      url: `/campaigns/${campaignId}/characters/${id}`,
      headers: auth(playerAToken),
    });
    expect(del.statusCode).toBe(200);

    const list = await app.inject({
      method: 'GET',
      url: `/campaigns/${campaignId}/characters`,
      headers: auth(playerAToken),
    });
    expect(
      (JSON.parse(list.body) as { id: string }[]).some((c) => c.id === id),
    ).toBe(false);

    const detail = await app.inject({
      method: 'GET',
      url: `/campaigns/${campaignId}/characters/${id}`,
      headers: auth(playerAToken),
    });
    expect(detail.statusCode).toBe(404);

    // already-deleted → 404
    const again = await app.inject({
      method: 'DELETE',
      url: `/campaigns/${campaignId}/characters/${id}`,
      headers: auth(playerAToken),
    });
    expect(again.statusCode).toBe(404);
  });
});
