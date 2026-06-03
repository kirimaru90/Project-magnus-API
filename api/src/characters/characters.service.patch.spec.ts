import { Types } from 'mongoose';
import { CharactersService } from './characters.service';
import { AuthenticatedUser } from '../auth/jwt.strategy';

function makeMockChar(overrides: Record<string, unknown> = {}) {
  return {
    _id: new Types.ObjectId(),
    campaignId: new Types.ObjectId(),
    userId: new Types.ObjectId(),
    special: {
      strength: 3,
      perception: 2,
      endurance: 2,
      charisma: 1,
      intelligence: 3,
      agility: 2,
      luck: 1,
    },
    skills: [],
    perks: [],
    positiveConditions: [],
    negativeConditions: [],
    criticalState: false,
    paMax: 10,
    paCurrent: 10,
    paTrackedBy: 'agility',
    resources: { caps: 100, bobbleheads: 5, scraps: 50 },
    inventory: { weapons: [], equip: [], consumables: [], other: [] },
    isDeleted: false,
    ...overrides,
  };
}

function makeService(char: ReturnType<typeof makeMockChar>) {
  const characterModel = {
    findOne: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(char),
    }),
    findByIdAndUpdate: jest.fn().mockImplementation((_id, update) => ({
      lean: jest.fn().mockResolvedValue({ ...char, ...update.$set }),
    })),
  };
  return new CharactersService(
    characterModel as never,
    {} as never,
  );
}

const adminActor: AuthenticatedUser = { id: 'admin-id', role: 'admin' };
function playerActor(char: ReturnType<typeof makeMockChar>): AuthenticatedUser {
  return { id: String(char.userId), role: 'player' };
}

// ─── 9.4: ignored array ───────────────────────────────────────

describe('patchSpecial — ignored', () => {
  it('non-admin gets disallowed_section in ignored, section unchanged', async () => {
    const char = makeMockChar();
    const svc = makeService(char);
    const result = await svc.patchSpecial(
      String(char.campaignId),
      String(char._id),
      { strength: 5 },
      playerActor(char),
    );
    expect(result.ignored).toEqual([
      { section: 'special', reason: 'disallowed_section' },
    ]);
    expect(result.section).toMatchObject(char.special);
  });

  it('admin has no ignored entries and section is updated', async () => {
    const char = makeMockChar();
    const svc = makeService(char);
    const result = await svc.patchSpecial(
      String(char.campaignId),
      String(char._id),
      { strength: 5 },
      adminActor,
    );
    expect(result.ignored).toEqual([]);
    expect(result.section.strength).toBe(5);
  });
});

describe('patchActionPoints — ignored', () => {
  it('non-admin sending paMax gets unauthorized_field in ignored', async () => {
    const char = makeMockChar();
    const svc = makeService(char);
    const result = await svc.patchActionPoints(
      String(char.campaignId),
      String(char._id),
      { paMax: 20, paCurrent: 8 },
      playerActor(char),
    );
    expect(result.ignored).toContainEqual({
      section: 'actionPoints',
      key: 'paMax',
      reason: 'unauthorized_field',
    });
    // paCurrent is allowed for players
    expect(result.section.paCurrent).toBe(8);
    // paMax from ignored must not be applied — original value is preserved
    expect(result.section.paMax).toBe(char.paMax);
  });

  it('clean player PATCH (paCurrent only) returns ignored: []', async () => {
    const char = makeMockChar();
    const svc = makeService(char);
    const result = await svc.patchActionPoints(
      String(char.campaignId),
      String(char._id),
      { paCurrent: 5 },
      playerActor(char),
    );
    expect(result.ignored).toEqual([]);
  });
});

describe('patchPerks — ignored', () => {
  it('non-admin gets disallowed_section in ignored', async () => {
    const char = makeMockChar();
    const svc = makeService(char);
    const result = await svc.patchPerks(
      String(char.campaignId),
      String(char._id),
      { items: [{ name: 'Bloody Mess' }] },
      playerActor(char),
    );
    expect(result.ignored).toEqual([
      { section: 'perks', reason: 'disallowed_section' },
    ]);
    expect(result.section).toEqual(char.perks);
  });

  it('admin with unknown nanoid id gets unknown_id in ignored', async () => {
    const char = makeMockChar();
    const svc = makeService(char);
    const result = await svc.patchPerks(
      String(char.campaignId),
      String(char._id),
      { items: [{ id: 'notexist', name: 'Ghost Perk' }] },
      adminActor,
    );
    expect(result.ignored).toContainEqual({
      section: 'perks',
      id: 'notexist',
      reason: 'unknown_id',
    });
  });

  it('clean admin PATCH returns ignored: []', async () => {
    const char = makeMockChar();
    const svc = makeService(char);
    const result = await svc.patchPerks(
      String(char.campaignId),
      String(char._id),
      { items: [{ name: 'Bloody Mess' }] }, // id-less → create
      adminActor,
    );
    expect(result.ignored).toEqual([]);
    expect(result.section).toHaveLength(1);
  });
});

// ─── 9.8: purged-field reflection in resources ────────────────

describe('patchResources — purged-field reflection', () => {
  it('non-admin PATCH with bobbleheads returns original bobbleheads in section', async () => {
    const char = makeMockChar({
      resources: { caps: 100, bobbleheads: 5, scraps: 50 },
    });
    const svc = makeService(char);

    const result = await svc.patchResources(
      String(char.campaignId),
      String(char._id),
      { caps: 200, bobbleheads: 10 },
      playerActor(char),
    );

    // bobbleheads was purged — section must reflect the original persisted value
    expect(result.section.bobbleheads).toBe(5);
    // caps was allowed — it should be updated
    expect(result.section.caps).toBe(200);
  });

  it('non-admin PATCH with bobbleheads yields an unauthorized_field ignored entry', async () => {
    const char = makeMockChar({
      resources: { caps: 100, bobbleheads: 5, scraps: 50 },
    });
    const svc = makeService(char);

    const result = await svc.patchResources(
      String(char.campaignId),
      String(char._id),
      { caps: 200, bobbleheads: 10 },
      playerActor(char),
    );

    expect(result.ignored).toContainEqual({
      section: 'resources',
      key: 'bobbleheads',
      reason: 'unauthorized_field',
    });
  });

  it('admin PATCH with bobbleheads updates it and has no ignored entry', async () => {
    const char = makeMockChar({
      resources: { caps: 100, bobbleheads: 5, scraps: 50 },
    });
    const svc = makeService(char);

    const result = await svc.patchResources(
      String(char.campaignId),
      String(char._id),
      { bobbleheads: 10 },
      adminActor,
    );

    expect(result.section.bobbleheads).toBe(10);
    expect(result.ignored).toEqual([]);
  });

  it('clean player PATCH (caps only) returns ignored: []', async () => {
    const char = makeMockChar();
    const svc = makeService(char);

    const result = await svc.patchResources(
      String(char.campaignId),
      String(char._id),
      { caps: 300 },
      playerActor(char),
    );

    expect(result.ignored).toEqual([]);
  });
});
