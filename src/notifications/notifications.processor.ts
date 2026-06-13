import { Inject, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import type { Transporter } from 'nodemailer';
import { NODEMAILER_TRANSPORT } from './nodemailer-transport.token';
import type { SendEmailJob } from '../queue/send-email-job.interface';

@Processor('notifications')
export class NotificationsProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsProcessor.name);

  constructor(
    @Inject(NODEMAILER_TRANSPORT) private readonly transporter: Transporter,
    private readonly config: ConfigService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name !== 'send-email') return;

    const data = job.data as SendEmailJob;
    const from = this.config.get<string>('EMAIL_FROM', 'noreply@immoplus.cm');

    await this.transporter.sendMail({
      from,
      to: data.to,
      subject: data.subject,
      html: this.renderTemplate(data.template, data.data),
    });

    this.logger.log(`Email sent to ${data.to} (template: ${data.template})`);
  }

  private renderTemplate(
    template: string,
    data: Record<string, unknown>,
  ): string {
    const rows = Object.entries(data)
      .map(
        ([k, v]) =>
          `<tr><td style="padding:4px 8px"><strong>${k}</strong></td><td style="padding:4px 8px">${String(v)}</td></tr>`,
      )
      .join('');
    return `<div style="font-family:sans-serif"><h2>${template}</h2><table border="0">${rows}</table></div>`;
  }
}
