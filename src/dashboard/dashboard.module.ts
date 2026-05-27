import { Module } from '@nestjs/common';
import { DashboardController, MaintenanceController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { PropertiesModule } from '../properties/properties.module';

@Module({
  imports: [PropertiesModule],
  controllers: [DashboardController, MaintenanceController],
  providers: [DashboardService],
})
export class DashboardModule {}
