import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

function makeService({
  user,
  campaignExists,
  updateOne = jest.fn().mockResolvedValue({}),
}: {
  user: object | null;
  campaignExists: boolean;
  updateOne?: jest.Mock;
}) {
  const userModel = {
    findById: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: () => Promise.resolve(user),
      }),
    }),
    updateOne,
  };
  const campaignModel = {
    exists: jest.fn().mockResolvedValue(campaignExists ? { _id: 'x' } : null),
  };
  return new AuthService(
    userModel as never,
    campaignModel as never,
    { sign: jest.fn() } as never,
  );
}

describe('AuthService.me', () => {
  it('returns id, username, role, lastCampaignId, unlockedHiddenIds', async () => {
    const svc = makeService({
      user: {
        _id: '1',
        username: 'alice',
        role: 'player',
        lastCampaignId: null,
        unlockedHiddenIds: new Map(),
      },
      campaignExists: false,
    });
    const result = await svc.me('1');
    expect(result).toEqual({
      id: '1',
      username: 'alice',
      role: 'player',
      lastCampaignId: null,
      unlockedHiddenIds: {},
    });
  });

  it('returns null lastCampaignId and empty unlockedHiddenIds when both are default', async () => {
    const svc = makeService({
      user: {
        _id: '1',
        username: 'bob',
        role: 'player',
        lastCampaignId: null,
        unlockedHiddenIds: new Map(),
      },
      campaignExists: false,
    });
    const result = await svc.me('1');
    expect(result.lastCampaignId).toBeNull();
    expect(result.unlockedHiddenIds).toEqual({});
  });

  it('serializes unlockedHiddenIds Map to plain object', async () => {
    const map = new Map([
      ['C1', ['vault-101']],
      ['C2', ['root', 'back-door']],
    ]);
    const svc = makeService({
      user: {
        _id: '1',
        username: 'alice',
        role: 'player',
        lastCampaignId: 'C1',
        unlockedHiddenIds: map,
      },
      campaignExists: true,
    });
    const result = await svc.me('1');
    expect(result.unlockedHiddenIds).toEqual({
      C1: ['vault-101'],
      C2: ['root', 'back-door'],
    });
  });

  it('returns lastCampaignId as-is when the campaign exists', async () => {
    const svc = makeService({
      user: {
        _id: '1',
        username: 'alice',
        role: 'player',
        lastCampaignId: 'C1',
        unlockedHiddenIds: new Map(),
      },
      campaignExists: true,
    });
    const result = await svc.me('1');
    expect(result.lastCampaignId).toBe('C1');
  });

  it('lazily nulls lastCampaignId when campaign no longer exists and persists the change', async () => {
    const updateOne = jest.fn().mockResolvedValue({});
    const svc = makeService({
      user: {
        _id: '1',
        username: 'alice',
        role: 'player',
        lastCampaignId: 'C-gone',
        unlockedHiddenIds: new Map(),
      },
      campaignExists: false,
      updateOne,
    });
    const result = await svc.me('1');
    expect(result.lastCampaignId).toBeNull();
    expect(updateOne).toHaveBeenCalledWith(
      { _id: '1' },
      { $set: { lastCampaignId: null } },
    );
  });

  it('throws UnauthorizedException when user not found', async () => {
    const svc = makeService({ user: null, campaignExists: false });
    await expect(svc.me('ghost')).rejects.toThrow(UnauthorizedException);
  });
});
