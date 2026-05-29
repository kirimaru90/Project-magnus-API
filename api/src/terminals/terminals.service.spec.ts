import { NotFoundException } from '@nestjs/common';
import { TerminalsService } from './terminals.service';
import { Types } from 'mongoose';

function makeConfigService(countAdminViews = false) {
  return { get: jest.fn().mockReturnValue(countAdminViews) };
}

function makeService(overrides: {
  terminalModel?: object;
  fictionalUserModel?: object;
  campaignModel?: object;
  userModel?: object;
}) {
  const terminalModel = overrides.terminalModel ?? {};
  const fictionalUserModel = overrides.fictionalUserModel ?? {
    deleteMany: jest.fn().mockResolvedValue({}),
  };
  const campaignModel = overrides.campaignModel ?? {};
  const userModel = overrides.userModel ?? {
    updateMany: jest.fn().mockResolvedValue({}),
  };
  return new TerminalsService(
    terminalModel as never,
    fictionalUserModel as never,
    campaignModel as never,
    userModel as never,
    makeConfigService() as never,
  );
}

describe('TerminalsService.delete cascade', () => {
  const campaignId = new Types.ObjectId();
  const terminalId = new Types.ObjectId();

  it('pulls hiddenId from all user unlock lists when terminal has hiddenId', async () => {
    const terminal = {
      _id: terminalId,
      campaignId,
      content: { meta: { hiddenId: 'vault-101', public: false } },
    };
    const userModel = { updateMany: jest.fn().mockResolvedValue({}) };
    const fictionalUserModel = { deleteMany: jest.fn().mockResolvedValue({}) };
    const terminalModel = {
      findByIdAndDelete: jest
        .fn()
        .mockReturnValue({ lean: () => Promise.resolve(terminal) }),
    };

    const svc = makeService({ terminalModel, fictionalUserModel, userModel });
    await svc.delete(String(terminalId));

    expect(userModel.updateMany).toHaveBeenCalledWith(
      {},
      { $pull: { [`unlockedHiddenIds.${String(campaignId)}`]: 'vault-101' } },
    );
  });

  it('does not call updateMany when deleted terminal has no hiddenId', async () => {
    const terminal = {
      _id: terminalId,
      campaignId,
      content: { meta: { public: true } },
    };
    const userModel = { updateMany: jest.fn().mockResolvedValue({}) };
    const fictionalUserModel = { deleteMany: jest.fn().mockResolvedValue({}) };
    const terminalModel = {
      findByIdAndDelete: jest
        .fn()
        .mockReturnValue({ lean: () => Promise.resolve(terminal) }),
    };

    const svc = makeService({ terminalModel, fictionalUserModel, userModel });
    await svc.delete(String(terminalId));

    expect(userModel.updateMany).not.toHaveBeenCalled();
  });

  it('does not call updateMany when terminal has null hiddenId', async () => {
    const terminal = {
      _id: terminalId,
      campaignId,
      content: { meta: { hiddenId: null, public: false } },
    };
    const userModel = { updateMany: jest.fn().mockResolvedValue({}) };
    const fictionalUserModel = { deleteMany: jest.fn().mockResolvedValue({}) };
    const terminalModel = {
      findByIdAndDelete: jest
        .fn()
        .mockReturnValue({ lean: () => Promise.resolve(terminal) }),
    };

    const svc = makeService({ terminalModel, fictionalUserModel, userModel });
    await svc.delete(String(terminalId));

    expect(userModel.updateMany).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when terminal does not exist', async () => {
    const userModel = { updateMany: jest.fn() };
    const terminalModel = {
      findByIdAndDelete: jest
        .fn()
        .mockReturnValue({ lean: () => Promise.resolve(null) }),
    };

    const svc = makeService({ terminalModel, userModel });
    await expect(svc.delete(String(terminalId))).rejects.toThrow(
      NotFoundException,
    );
    expect(userModel.updateMany).not.toHaveBeenCalled();
  });
});

describe('TerminalsService.listByCampaign filter', () => {
  const campaignId = new Types.ObjectId();
  const publicTerminal = {
    _id: new Types.ObjectId(),
    campaignId,
    title: 'Public',
    content: { meta: { public: true } },
    viewCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const privateTerminal = {
    _id: new Types.ObjectId(),
    campaignId,
    title: 'Private',
    content: { meta: { public: false, hiddenId: 'vault-101' } },
    viewCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  function makeListService(userDoc: object | null) {
    const terminalModel = {
      find: jest.fn().mockReturnValue({
        lean: () => Promise.resolve([publicTerminal, privateTerminal]),
      }),
    };
    const userModel = {
      findById: jest.fn().mockReturnValue({
        select: jest
          .fn()
          .mockReturnValue({ lean: () => Promise.resolve(userDoc) }),
      }),
    };
    return makeService({ terminalModel, userModel });
  }

  it('admin sees all terminals', async () => {
    const svc = makeListService(null);
    const result = await svc.listByCampaign(String(campaignId), {
      id: 'a',
      role: 'admin',
    });
    expect(result).toHaveLength(2);
  });

  it('player with empty unlocks sees only public terminal', async () => {
    const svc = makeListService({ unlockedHiddenIds: new Map() });
    const result = await svc.listByCampaign(String(campaignId), {
      id: 'p',
      role: 'player',
    });
    expect(result).toHaveLength(1);
    expect(result[0].isPublic).toBe(true);
  });

  it('player with matching unlock sees unlocked private terminal', async () => {
    const unlocks = new Map([[String(campaignId), ['vault-101']]]);
    const svc = makeListService({ unlockedHiddenIds: unlocks });
    const result = await svc.listByCampaign(String(campaignId), {
      id: 'p',
      role: 'player',
    });
    expect(result).toHaveLength(2);
  });

  it('anonymous caller sees only public terminal', async () => {
    const svc = makeListService(null);
    const result = await svc.listByCampaign(String(campaignId), undefined);
    expect(result).toHaveLength(1);
    expect(result[0].isPublic).toBe(true);
  });

  it('hiddenId field present on summary when set', async () => {
    const terminalModel = {
      find: jest
        .fn()
        .mockReturnValue({ lean: () => Promise.resolve([privateTerminal]) }),
    };
    const svc = makeService({
      terminalModel,
      userModel: { updateMany: jest.fn() },
    });
    const result = await svc.listByCampaign(String(campaignId), {
      id: 'a',
      role: 'admin',
    });
    expect(result[0].hiddenId).toBe('vault-101');
  });

  it('hiddenId field omitted on summary when absent (no hiddenId key on meta)', async () => {
    const terminalModel = {
      find: jest
        .fn()
        .mockReturnValue({ lean: () => Promise.resolve([publicTerminal]) }),
    };
    const svc = makeService({
      terminalModel,
      userModel: { updateMany: jest.fn() },
    });
    const result = await svc.listByCampaign(String(campaignId), {
      id: 'a',
      role: 'admin',
    });
    expect(result[0]).not.toHaveProperty('hiddenId');
  });
});

describe('TerminalsService.load lastCampaignId write', () => {
  const campaignId = new Types.ObjectId();
  const terminalId = new Types.ObjectId();

  const terminal = {
    _id: terminalId,
    campaignId,
    title: 'T',
    content: { meta: { public: true } },
    state: {},
    viewCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const campaign = { _id: campaignId, state: {} };

  function makeLoadService(updateOne = jest.fn().mockResolvedValue({})) {
    const terminalModel = {
      findById: jest
        .fn()
        .mockReturnValue({ lean: () => Promise.resolve(terminal) }),
      updateOne: jest.fn().mockResolvedValue({}),
    };
    const campaignModel = {
      findById: jest
        .fn()
        .mockReturnValue({ lean: () => Promise.resolve(campaign) }),
    };
    const userModel = { updateOne };
    return {
      svc: makeService({ terminalModel, campaignModel, userModel }),
      updateOne,
    };
  }

  it('sets lastCampaignId for admin on successful load', async () => {
    const { svc, updateOne } = makeLoadService();
    await svc.load(String(terminalId), { id: 'admin1', role: 'admin' });
    expect(updateOne).toHaveBeenCalledWith(
      { _id: 'admin1' },
      { $set: { lastCampaignId: String(campaignId) } },
    );
  });

  it('sets lastCampaignId for player on successful load', async () => {
    const { svc, updateOne } = makeLoadService();
    await svc.load(String(terminalId), { id: 'player1', role: 'player' });
    expect(updateOne).toHaveBeenCalledWith(
      { _id: 'player1' },
      { $set: { lastCampaignId: String(campaignId) } },
    );
  });

  it('does not write when actor is anonymous', async () => {
    const { svc, updateOne } = makeLoadService();
    await svc.load(String(terminalId), undefined);
    expect(updateOne).not.toHaveBeenCalled();
  });

  it('load response payload contains content, localState, globalState only', async () => {
    const { svc } = makeLoadService();
    const result = await svc.load(String(terminalId), {
      id: 'p',
      role: 'player',
    });
    expect(Object.keys(result)).toEqual(
      expect.arrayContaining(['content', 'localState', 'globalState']),
    );
    expect(Object.keys(result)).toHaveLength(3);
  });
});

describe('TerminalsService.loadByHiddenId writes and self-heal', () => {
  const campaignId = new Types.ObjectId();
  const terminalId = new Types.ObjectId();
  const campaignIdStr = String(campaignId);

  const terminal = {
    _id: terminalId,
    campaignId,
    title: 'Hidden',
    content: { meta: { public: false, hiddenId: 'vault-101' } },
    state: {},
    viewCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const campaign = { _id: campaignId, state: {} };

  function makeHiddenService(
    foundTerminal: object | null,
    updateOne = jest.fn().mockResolvedValue({}),
  ) {
    const terminalModel = {
      findOne: jest
        .fn()
        .mockReturnValue({ lean: () => Promise.resolve(foundTerminal) }),
      updateOne: jest.fn().mockResolvedValue({}),
    };
    const campaignModel = {
      findById: jest
        .fn()
        .mockReturnValue({ lean: () => Promise.resolve(campaign) }),
    };
    const userModel = { updateOne };
    return {
      svc: makeService({ terminalModel, campaignModel, userModel }),
      updateOne,
    };
  }

  it('records player unlock on successful resolution', async () => {
    const { svc, updateOne } = makeHiddenService(terminal);
    await svc.loadByHiddenId(campaignIdStr, 'vault-101', {
      id: 'p1',
      role: 'player',
    });
    expect(updateOne).toHaveBeenCalledWith(
      { _id: 'p1' },
      { $addToSet: { [`unlockedHiddenIds.${campaignIdStr}`]: 'vault-101' } },
    );
  });

  it('does not duplicate unlock (addToSet is idempotent)', async () => {
    const { svc, updateOne } = makeHiddenService(terminal);
    await svc.loadByHiddenId(campaignIdStr, 'vault-101', {
      id: 'p1',
      role: 'player',
    });
    // $addToSet is a single call; the database ensures idempotency
    expect(updateOne).toHaveBeenCalledWith(
      { _id: 'p1' },
      { $addToSet: { [`unlockedHiddenIds.${campaignIdStr}`]: 'vault-101' } },
    );
  });

  it('admin resolution does not write unlock', async () => {
    const { svc, updateOne } = makeHiddenService(terminal);
    await svc.loadByHiddenId(campaignIdStr, 'vault-101', {
      id: 'a1',
      role: 'admin',
    });
    const addToSetCalls = updateOne.mock.calls.filter((c: unknown[]) =>
      JSON.stringify(c[1]).includes('$addToSet'),
    );
    expect(addToSetCalls).toHaveLength(0);
  });

  it('sets lastCampaignId for player on success', async () => {
    const { svc, updateOne } = makeHiddenService(terminal);
    await svc.loadByHiddenId(campaignIdStr, 'vault-101', {
      id: 'p1',
      role: 'player',
    });
    expect(updateOne).toHaveBeenCalledWith(
      { _id: 'p1' },
      { $set: { lastCampaignId: campaignIdStr } },
    );
  });

  it('sets lastCampaignId for admin on success', async () => {
    const { svc, updateOne } = makeHiddenService(terminal);
    await svc.loadByHiddenId(campaignIdStr, 'vault-101', {
      id: 'a1',
      role: 'admin',
    });
    expect(updateOne).toHaveBeenCalledWith(
      { _id: 'a1' },
      { $set: { lastCampaignId: campaignIdStr } },
    );
  });

  it('anonymous success writes nothing', async () => {
    const { svc, updateOne } = makeHiddenService(terminal);
    await svc.loadByHiddenId(campaignIdStr, 'vault-101', undefined);
    expect(updateOne).not.toHaveBeenCalled();
  });

  it('self-heals stale unlock on 404 (terminal missing)', async () => {
    const { svc, updateOne } = makeHiddenService(null);
    await expect(
      svc.loadByHiddenId(campaignIdStr, 'vault-101', {
        id: 'p1',
        role: 'player',
      }),
    ).rejects.toThrow(NotFoundException);
    expect(updateOne).toHaveBeenCalledWith(
      { _id: 'p1' },
      { $pull: { [`unlockedHiddenIds.${campaignIdStr}`]: 'vault-101' } },
    );
  });

  it('no self-heal for anonymous on 404', async () => {
    const { svc, updateOne } = makeHiddenService(null);
    await expect(
      svc.loadByHiddenId(campaignIdStr, 'vault-101', undefined),
    ).rejects.toThrow(NotFoundException);
    expect(updateOne).not.toHaveBeenCalled();
  });
});
