import {
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { AdminGuard } from './admin.guard';
import { TerminalAccessGuard } from './terminal-access.guard';

function makeCtx(user: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('AdminGuard', () => {
  const guard = new AdminGuard();

  it('allows admin', () => {
    expect(guard.canActivate(makeCtx({ id: '1', role: 'admin' }))).toBe(true);
  });

  it('throws Forbidden for player', () => {
    expect(() =>
      guard.canActivate(makeCtx({ id: '1', role: 'player' })),
    ).toThrow(ForbiddenException);
  });

  it('throws Unauthorized when no user', () => {
    expect(() => guard.canActivate(makeCtx(undefined))).toThrow(
      UnauthorizedException,
    );
  });
});

// TerminalAccessGuard helpers
const campaignId = new Types.ObjectId();
const terminalId = new Types.ObjectId();
const playerId = new Types.ObjectId();

function makeTerminalCtx(
  user: unknown,
  id = String(terminalId),
): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user, params: { id } }) }),
  } as unknown as ExecutionContext;
}

function makeTerminalGuard({
  terminal,
  campaign,
  userDoc,
}: {
  terminal: object | null;
  campaign: object | null;
  userDoc?: object | null;
}) {
  const terminalModel = {
    findById: jest
      .fn()
      .mockReturnValue({ lean: () => Promise.resolve(terminal) }),
  };
  const campaignModel = {
    findById: jest
      .fn()
      .mockReturnValue({ lean: () => Promise.resolve(campaign) }),
  };
  const userModel = {
    findById: jest.fn().mockReturnValue({
      select: jest
        .fn()
        .mockReturnValue({ lean: () => Promise.resolve(userDoc ?? null) }),
    }),
  };
  return new TerminalAccessGuard(
    terminalModel as never,
    campaignModel as never,
    userModel as never,
  );
}

const publicCampaign = {
  _id: campaignId,
  isActive: true,
  isPublic: true,
  players: [],
};

const privateCampaign = {
  _id: campaignId,
  isActive: true,
  isPublic: false,
  players: [playerId],
};

describe('TerminalAccessGuard', () => {
  it('admin bypasses privacy check on non-public terminal', async () => {
    const guard = makeTerminalGuard({
      terminal: {
        _id: terminalId,
        campaignId,
        content: { meta: { public: false, hiddenId: 'vault-101' } },
      },
      campaign: privateCampaign,
    });
    const result = await guard.canActivate(
      makeTerminalCtx({ id: String(playerId), role: 'admin' }),
    );
    expect(result).toBe(true);
  });

  it('public terminal passes for any player without unlock', async () => {
    const guard = makeTerminalGuard({
      terminal: {
        _id: terminalId,
        campaignId,
        content: { meta: { public: true } },
      },
      campaign: publicCampaign,
    });
    const result = await guard.canActivate(
      makeTerminalCtx({ id: String(playerId), role: 'player' }),
    );
    expect(result).toBe(true);
  });

  it('player with matching unlock passes for non-public terminal', async () => {
    const unlocks = new Map([[String(campaignId), ['vault-101']]]);
    const guard = makeTerminalGuard({
      terminal: {
        _id: terminalId,
        campaignId,
        content: { meta: { public: false, hiddenId: 'vault-101' } },
      },
      campaign: privateCampaign,
      userDoc: { _id: playerId, unlockedHiddenIds: unlocks },
    });
    const result = await guard.canActivate(
      makeTerminalCtx({ id: String(playerId), role: 'player' }),
    );
    expect(result).toBe(true);
  });

  it('player without unlock is denied (404) for non-public terminal', async () => {
    const guard = makeTerminalGuard({
      terminal: {
        _id: terminalId,
        campaignId,
        content: { meta: { public: false, hiddenId: 'vault-101' } },
      },
      campaign: privateCampaign,
      userDoc: { _id: playerId, unlockedHiddenIds: new Map() },
    });
    await expect(
      guard.canActivate(
        makeTerminalCtx({ id: String(playerId), role: 'player' }),
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('anonymous caller is denied (404) for non-public terminal', async () => {
    const guard = makeTerminalGuard({
      terminal: {
        _id: terminalId,
        campaignId,
        content: { meta: { public: false, hiddenId: 'vault-101' } },
      },
      campaign: publicCampaign,
    });
    await expect(guard.canActivate(makeTerminalCtx(undefined))).rejects.toThrow(
      NotFoundException,
    );
  });

  it('private terminal with no hiddenId is denied to non-admin', async () => {
    const guard = makeTerminalGuard({
      terminal: {
        _id: terminalId,
        campaignId,
        content: { meta: { public: false } },
      },
      campaign: privateCampaign,
      userDoc: { _id: playerId, unlockedHiddenIds: new Map() },
    });
    await expect(
      guard.canActivate(
        makeTerminalCtx({ id: String(playerId), role: 'player' }),
      ),
    ).rejects.toThrow(NotFoundException);
  });
});
