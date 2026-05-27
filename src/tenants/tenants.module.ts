import { Module } from '@nestjs/common';
import { ApplicationsController, TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';

@Module({
  controllers: [TenantsController, ApplicationsController],
  providers: [TenantsService],
  exports: [TenantsService],
})
export class TenantsModule {}
