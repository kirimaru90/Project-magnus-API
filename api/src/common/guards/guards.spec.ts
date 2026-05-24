import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { AdminGuard } from './admin.guard';

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
