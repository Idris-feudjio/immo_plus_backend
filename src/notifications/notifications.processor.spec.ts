import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { NotificationsProcessor } from './notifications.processor';
import { NODEMAILER_TRANSPORT } from './nodemailer-transport.token';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeJob(name: string, data: object): Job {
  return { name, data } as Job;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('NotificationsProcessor', () => {
  let processor: NotificationsProcessor;
  let mockTransport: { sendMail: jest.Mock };

  beforeEach(async () => {
    mockTransport = {
      sendMail: jest.fn().mockResolvedValue({ messageId: 'test-msg-id' }),
    };

    const module = await Test.createTestingModule({
      providers: [
        NotificationsProcessor,
        { provide: NODEMAILER_TRANSPORT, useValue: mockTransport },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: unknown) => {
              if (key === 'EMAIL_FROM') return 'test@immoplus.cm';
              return defaultValue;
            }),
          },
        },
      ],
    }).compile();

    processor = module.get(NotificationsProcessor);
  });

  describe('process', () => {
    it('calls transporter.sendMail for a send-email job', async () => {
      const job = makeJob('send-email', {
        to: 'tenant@example.com',
        subject: 'Quittance Juillet 2026',
        template: 'receipt',
        data: { period: 'Juillet 2026', amount: '238 500 FCFA' },
      });

      await processor.process(job);

      expect(mockTransport.sendMail).toHaveBeenCalledTimes(1);
      expect(mockTransport.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'test@immoplus.cm',
          to: 'tenant@example.com',
          subject: 'Quittance Juillet 2026',
        }),
      );
    });

    it('sends html containing the template name', async () => {
      const job = makeJob('send-email', {
        to: 'user@example.com',
        subject: 'OTP',
        template: 'otp',
        data: { code: '123456' },
      });

      await processor.process(job);

      const [mailOptions] = mockTransport.sendMail.mock.calls[0] as [
        { html: string },
      ];
      expect(mailOptions.html).toContain('otp');
    });

    it('does nothing and does not call sendMail for unknown job names', async () => {
      await processor.process(makeJob('unknown-job', {}));
      expect(mockTransport.sendMail).not.toHaveBeenCalled();
    });

    it('resolves without error for send-email job', async () => {
      const job = makeJob('send-email', {
        to: 'a@b.com',
        subject: 'Test',
        template: 'test',
        data: {},
      });
      await expect(processor.process(job)).resolves.toBeUndefined();
    });
  });
});
