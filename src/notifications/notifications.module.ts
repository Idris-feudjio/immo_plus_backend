import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';
import { QueueModule } from '../queue/queue.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationRepository } from './notification.repository';
import { NotificationsProcessor } from './notifications.processor';
import { EmailQueueService } from './email-queue.service';
import { NOTIFICATIONS_SERVICE } from './interfaces/notification-service.interface';
import { NODEMAILER_TRANSPORT } from './nodemailer-transport.token';

@Module({
  imports: [QueueModule],
  controllers: [NotificationsController],
  providers: [
    NotificationRepository,
    { provide: NOTIFICATIONS_SERVICE, useClass: NotificationsService },
    {
      provide: NODEMAILER_TRANSPORT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        nodemailer.createTransport({
          host: config.get<string>('SMTP_HOST', 'localhost'),
          port: config.get<number>('SMTP_PORT', 587),
          secure: false,
          auth: {
            user: config.get<string>('SMTP_USER', ''),
            pass: config.get<string>('SMTP_PASS', ''),
          },
        }),
    },
    NotificationsProcessor,
    EmailQueueService,
  ],
  exports: [NOTIFICATIONS_SERVICE, NotificationRepository, EmailQueueService],
})
export class NotificationsModule {}
