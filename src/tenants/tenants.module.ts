import { Module } from '@nestjs/common';
import { TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';
import { TenantRepository } from './tenant.repository';
@Module({
  controllers: [TenantsController],
  providers: [TenantRepository, TenantsService],
  exports: [TenantsService, TenantRepository],
})
export class TenantsModule {}
