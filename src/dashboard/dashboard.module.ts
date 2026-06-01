import { Module } from '@nestjs/common';
import { DashboardController, MaintenanceController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { DASHBOARD_SERVICE } from './interfaces/dashboard-service.interface';
import { PropertiesModule } from '../properties/properties.module';

@Module({
  imports: [PropertiesModule],
  controllers: [DashboardController, MaintenanceController],
  providers: [{ provide: DASHBOARD_SERVICE, useClass: DashboardService }],
  exports: [DASHBOARD_SERVICE],
})
export class DashboardModule {}
