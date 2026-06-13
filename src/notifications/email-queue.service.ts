import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { NOTIFICATIONS_QUEUE } from '../queue/queue.module';
import type { SendEmailJob } from '../queue/send-email-job.interface';

const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5000 },
} as const;

@Injectable()
export class EmailQueueService {
  constructor(
    @InjectQueue(NOTIFICATIONS_QUEUE) private readonly queue: Queue,
  ) {}

  async sendEmail(dto: SendEmailJob): Promise<void> {
    await this.queue.add('send-email', dto, DEFAULT_JOB_OPTIONS);
  }
}
