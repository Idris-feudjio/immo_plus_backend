import { Module } from '@nestjs/common';
import { MandatesModule } from '../mandates/mandates.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TurnstileGuard } from '../common/guards/turnstile.guard.js';
import { ApplicationsController } from './applications.controller';
import { ApplicationRepository } from './application.repository';
import { ApplicationsService } from './applications.service';

@Module({
  imports: [NotificationsModule, MandatesModule],
  controllers: [ApplicationsController],
  providers: [ApplicationRepository, ApplicationsService, TurnstileGuard],
})
export class ApplicationsModule {}
