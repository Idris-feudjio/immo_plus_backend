import { SetMetadata } from '@nestjs/common';

export const PLAN_LIMIT_KEY = 'planLimitResource';
export const CheckPlanLimit = (resource: string) => SetMetadata(PLAN_LIMIT_KEY, resource);
