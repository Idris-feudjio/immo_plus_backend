import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { TurnstileGuard } from '../common/guards/turnstile.guard.js';
import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';

@Module({
  imports: [NotificationsModule],
  controllers: [ApplicationsController],
  providers: [ApplicationsService, TurnstileGuard],
})
export class ApplicationsModule {}
