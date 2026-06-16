import { Module } from '@nestjs/common';
import { MandatesModule } from '../mandates/mandates.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { MaintenanceController } from './maintenance.controller';
import { MaintenanceRepository } from './maintenance.repository';
import { MaintenanceService } from './maintenance.service';

@Module({
  imports: [NotificationsModule, MandatesModule],
  controllers: [MaintenanceController],
  providers: [MaintenanceRepository, MaintenanceService],
})
export class MaintenanceModule {}
