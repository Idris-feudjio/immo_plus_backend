import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { PdfService } from '../common/services/pdf.service';
import { CommissionsController } from './commissions.controller';
import { CommissionsService } from './commissions.service';
import { CommissionRepository } from './commission.repository';
@Module({
  imports: [NotificationsModule],
  controllers: [CommissionsController],
  providers: [CommissionRepository, PdfService, CommissionsService],
})
export class CommissionsModule {}
