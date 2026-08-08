import { Module } from '@nestjs/common';
import { PlanLimitService } from './plan-limit.service';
import { PlansController } from './plans.controller';
import { PlansService } from './plans.service';

@Module({
  controllers: [PlansController],
  providers: [PlanLimitService, PlansService],
  exports: [PlanLimitService],
})
export class PlansModule {}
