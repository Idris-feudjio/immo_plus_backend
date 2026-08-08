import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PLAN_LIMIT_KEY } from '../decorators/check-plan-limit.decorator';

/**
 * STUB — still always allows. Story 2.1 introduced Plan/Subscription/Trial
 * and a real, unit-tested PlanLimitService (src/plans/plan-limit.service.ts),
 * but this guard deliberately does not call it yet: wiring PlanLimitService
 * into this guard and returning 403 PLAN_LIMIT_EXCEEDED is Story 2.2's scope,
 * bundled together with deploying @CheckPlanLimit on the other endpoints it
 * needs to cover (users, PDF) as one coherent change.
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
