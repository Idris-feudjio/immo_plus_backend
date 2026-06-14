import { Global, Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { MandateGuard } from '../common/guards/mandate.guard';
import { MandatesController } from './mandates.controller';
import { MandateRepository } from './mandate.repository';
import { MandatesService } from './mandates.service';
@Global()
@Module({
  imports: [NotificationsModule],
  controllers: [MandatesController],
  providers: [MandateRepository, MandateGuard, MandatesService],
  exports: [MandateRepository, MandateGuard],
})
export class MandatesModule {}
