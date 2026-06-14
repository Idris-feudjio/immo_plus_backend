import { Module } from '@nestjs/common';
import { TurnstileGuard } from '../common/guards/turnstile.guard.js';
import { ApplicationsController, TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';
import { TenantRepository } from './tenant.repository';
@Module({
  controllers: [TenantsController, ApplicationsController],
  providers: [TenantRepository, TenantsService, TurnstileGuard],
  exports: [TenantsService, TenantRepository],
})
export class TenantsModule {}
