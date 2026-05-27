import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';

export const PDF_QUEUE = 'pdf';
export const EMAIL_QUEUE = 'email';
export const SMS_QUEUE = 'sms';

@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          url: config.get<string>('REDIS_URL', 'redis://localhost:6379'),
        },
      }),
    }),
    BullModule.registerQueue(
      { name: PDF_QUEUE },
      { name: EMAIL_QUEUE },
      { name: SMS_QUEUE },
    ),
  ],
  exports: [BullModule],
})
export class QueueModule {}
