import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PlanLimitGuard } from './plan-limit.guard';

function makeContext(): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('PlanLimitGuard', () => {
  let guard: PlanLimitGuard;
  let reflector: { getAllAndOverride: jest.Mock };

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    guard = new PlanLimitGuard(reflector as unknown as Reflector);
  });

  it('allows the request when @CheckPlanLimit metadata is present (stub, no quota logic yet)', () => {
    reflector.getAllAndOverride.mockReturnValue('properties');

    expect(guard.canActivate(makeContext())).toBe(true);
  });

  it('allows the request when no @CheckPlanLimit metadata is present', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);

    expect(guard.canActivate(makeContext())).toBe(true);
  });
});
