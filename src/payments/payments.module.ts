import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PaymentRepository } from './payment.repository';
import { PAYMENTS_SERVICE } from './interfaces/payments-service.interface';

@Module({
  imports: [NotificationsModule],
  controllers: [PaymentsController],
  providers: [
    PaymentRepository,
    { provide: PAYMENTS_SERVICE, useClass: PaymentsService },
  ],
  exports: [PAYMENTS_SERVICE, PaymentRepository],
})
export class PaymentsModule {}
