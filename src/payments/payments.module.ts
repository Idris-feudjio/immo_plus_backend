import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PaymentRepository } from './payment.repository';
@Module({
  imports: [NotificationsModule],
  controllers: [PaymentsController],
  providers: [PaymentRepository, PaymentsService],
  exports: [PaymentsService, PaymentRepository],
})
export class PaymentsModule {}
