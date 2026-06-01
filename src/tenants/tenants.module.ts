import { Module } from '@nestjs/common';
import { ApplicationsController, TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';
import { TenantRepository } from './tenant.repository';
import { TENANTS_SERVICE } from './interfaces/tenants-service.interface';

@Module({
  controllers: [TenantsController, ApplicationsController],
  providers: [
    TenantRepository,
    { provide: TENANTS_SERVICE, useClass: TenantsService },
  ],
  exports: [TENANTS_SERVICE, TenantRepository],
})
export class TenantsModule {}
