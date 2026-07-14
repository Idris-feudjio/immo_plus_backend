import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PLAN_LIMIT_KEY } from '../decorators/check-plan-limit.decorator';

/**
 * STUB — Epic 2 (Story 2.1) will replace this with a real quota check via
 * PlanLimitService. No Plan/Subscription/Organization model exists yet in the
 * Prisma schema, so no business logic belongs here until Epic 2 is built.
 * Always allows — @CheckPlanLimit(resource) is only a pre-wired attachment
 * point for Epic 2 to fill in later.
 */
@Injectable()
export class PlanLimitGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const resource = this.reflector.getAllAndOverride<string>(PLAN_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!resource) return true;
    return true;
  }
}
