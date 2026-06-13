import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { NotificationsModule } from '../notifications/notifications.module';
import { CronService } from './cron.service';

@Module({
  imports: [ScheduleModule.forRoot(), NotificationsModule],
  providers: [CronService],
})
export class CronModule {}
