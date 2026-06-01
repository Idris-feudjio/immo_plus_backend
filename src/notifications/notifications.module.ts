import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationRepository } from './notification.repository';
import { NOTIFICATIONS_SERVICE } from './interfaces/notification-service.interface';

@Module({
  controllers: [NotificationsController],
  providers: [
    NotificationRepository,
    { provide: NOTIFICATIONS_SERVICE, useClass: NotificationsService },
  ],
  exports: [NOTIFICATIONS_SERVICE, NotificationRepository],
})
export class NotificationsModule {}
