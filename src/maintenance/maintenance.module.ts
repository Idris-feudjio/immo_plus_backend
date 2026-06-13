import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { MAINTENANCE_SERVICE } from './interfaces/maintenance-service.interface';
import { MaintenanceController } from './maintenance.controller';
import { MaintenanceService } from './maintenance.service';

@Module({
  imports: [NotificationsModule],
  controllers: [MaintenanceController],
  providers: [{ provide: MAINTENANCE_SERVICE, useClass: MaintenanceService }],
})
export class MaintenanceModule {}
