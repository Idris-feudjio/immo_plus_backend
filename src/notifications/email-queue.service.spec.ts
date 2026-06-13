import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { EmailQueueService } from './email-queue.service';
import { NOTIFICATIONS_QUEUE } from '../queue/queue.module';

describe('EmailQueueService', () => {
  let service: EmailQueueService;
  let mockQueue: { add: jest.Mock };

  beforeEach(async () => {
    mockQueue = { add: jest.fn().mockResolvedValue({ id: 'job-1' }) };

    const module = await Test.createTestingModule({
      providers: [
        EmailQueueService,
        {
          provide: getQueueToken(NOTIFICATIONS_QUEUE),
          useValue: mockQueue,
        },
      ],
    }).compile();

    service = module.get(EmailQueueService);
  });

  describe('sendEmail', () => {
    it('calls queue.add with job name "send-email"', async () => {
      await service.sendEmail({
        to: 'test@example.com',
        subject: 'Hello',
        template: 'otp',
        data: { code: '654321' },
      });

      expect(mockQueue.add).toHaveBeenCalledWith(
        'send-email',
        expect.objectContaining({ to: 'test@example.com', subject: 'Hello' }),
        expect.anything(),
      );
    });

    it('uses attempts: 3 and exponential backoff', async () => {
      await service.sendEmail({
        to: 'a@b.com',
        subject: 'Test',
        template: 'receipt',
        data: { amount: '50000' },
      });

      expect(mockQueue.add).toHaveBeenCalledWith(
        'send-email',
        expect.anything(),
        expect.objectContaining({
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
        }),
      );
    });

    it('passes the full dto payload to the queue', async () => {
      const dto = {
        to: 'owner@example.com',
        subject: 'Alerte bail',
        template: 'lease-expiry',
        data: { days: 7, propertyTitle: 'Villa Bastos' },
      };

      await service.sendEmail(dto);

      expect(mockQueue.add).toHaveBeenCalledWith(
        'send-email',
        expect.objectContaining(dto),
        expect.anything(),
      );
    });
  });
});
