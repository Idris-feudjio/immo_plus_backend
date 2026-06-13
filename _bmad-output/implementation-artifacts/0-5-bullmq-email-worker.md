---
baseline_commit: 575809f0348d090b16021b5edc06a6cbceee234f
---

# Story 0.5: BullMQ configuration pour notifications email

Status: review

## Story

As a **developer**,
I want a BullMQ `notifications` queue configured with a `NotificationsProcessor` worker,
So that email notifications can be sent asynchronously with retry logic, decoupled from business transactions.

## Acceptance Criteria

1. `QueueModule` is imported in `AppModule` — BullMQ and the `notifications` queue are globally available.
2. A `send-email` job with payload `{ to: string, subject: string, template: string, data: Record<string, unknown> }` can be added to the `notifications` queue.
3. Jobs are configured with `{ attempts: 3, backoff: { type: 'exponential', delay: 5000 } }` by default via `EmailQueueService.sendEmail()`.
4. `NotificationsProcessor` (`@Processor('notifications')`) processes `send-email` jobs by calling `transporter.sendMail()` with the correct `from`, `to`, `subject`, and `html` fields.
5. The nodemailer transporter is injected via a `NODEMAILER_TRANSPORT` provider token — making it replaceable in tests without patching nodemailer directly.
6. `EmailQueueService` is exported from `NotificationsModule` and can be injected in any module that imports `NotificationsModule`.
7. All 30 pre-existing tests continue to pass (no regressions).

## Tasks / Subtasks

- [x] Task 1 — Update QueueModule to add `notifications` queue (AC: 1, 2)
  - [x] Add `export const NOTIFICATIONS_QUEUE = 'notifications'` constant to `src/queue/queue.module.ts`
  - [x] Add `{ name: NOTIFICATIONS_QUEUE }` to `BullModule.registerQueue(...)` call
  - [x] Import `QueueModule` in `src/app.module.ts`

- [x] Task 2 — Define job interface (AC: 2)
  - [x] Create `src/queue/send-email-job.interface.ts` with `SendEmailJob` interface

- [x] Task 3 — Create nodemailer transport provider (AC: 5)
  - [x] Create `src/notifications/nodemailer-transport.token.ts` exporting `NODEMAILER_TRANSPORT` constant
  - [x] Add transport factory provider to `NotificationsModule` using `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` from `ConfigService`

- [x] Task 4 — Implement NotificationsProcessor (AC: 4, 5)
  - [x] Create `src/notifications/notifications.processor.ts` — `@Processor('notifications')` extending `WorkerHost`
  - [x] Handle `send-email` job: call `transporter.sendMail()` with html from `renderTemplate()`
  - [x] Implement private `renderTemplate(template: string, data: Record<string, unknown>): string` — minimal HTML per template name
  - [x] Log job success and failures using `Logger`

- [x] Task 5 — Implement EmailQueueService (AC: 3, 6)
  - [x] Create `src/notifications/email-queue.service.ts` — `@Injectable()` service
  - [x] Inject `@InjectQueue(NOTIFICATIONS_QUEUE)` Queue
  - [x] Implement `sendEmail(dto: SendEmailJob): Promise<void>` — calls `queue.add('send-email', dto, { attempts: 3, backoff: { type: 'exponential', delay: 5000 } })`

- [x] Task 6 — Wire NotificationsModule (AC: 5, 6)
  - [x] Update `src/notifications/notifications.module.ts`:
    - Import `QueueModule` (from `src/queue/queue.module.ts`)
    - Add `NotificationsProcessor`, `EmailQueueService`, and `NODEMAILER_TRANSPORT` factory to `providers`
    - Export `EmailQueueService`

- [x] Task 7 — Write tests (AC: 4, 5, 6, 7)
  - [x] Create `src/notifications/notifications.processor.spec.ts` — mock transport, verify `sendMail()` called with correct payload
  - [x] Create `src/notifications/email-queue.service.spec.ts` — mock Queue, verify `queue.add()` called with `{ attempts: 3, backoff }` options
  - [x] Run full test suite — 37 tests pass (7 new + 30 pre-existing), no regressions

## Dev Notes

### Key Dependencies

All already installed:
- `@nestjs/bullmq@^11.0.4`
- `bullmq@^5.77.6`
- `nodemailer@^8.0.9`
- `@types/nodemailer@^8.0.0`

No new packages needed.

### Existing QueueModule State

`src/queue/queue.module.ts` already exists with:
```typescript
export const PDF_QUEUE = 'pdf';
export const EMAIL_QUEUE = 'email';   // NOT the notifications queue
export const SMS_QUEUE = 'sms';

BullModule.forRootAsync({ ... })  // uses REDIS_URL from ConfigService
BullModule.registerQueue({ name: PDF_QUEUE }, { name: EMAIL_QUEUE }, { name: SMS_QUEUE })
exports: [BullModule]
```

**Architecture §14.3 mandates queue name `'notifications'`** — this is different from the existing `'email'` queue. Keep existing constants, add:
```typescript
export const NOTIFICATIONS_QUEUE = 'notifications';
```
Then add `{ name: NOTIFICATIONS_QUEUE }` to `registerQueue`.

### AppModule: QueueModule is NOT imported yet

The sprint-status note confirms: "QueueModule exists but not imported in AppModule". Add `QueueModule` to `AppModule.imports[]` alongside `CronModule`:

```typescript
import { QueueModule } from './queue/queue.module';

// In imports[]:
CronModule,
QueueModule,
```

### Nodemailer Transport Token

Use a provider token to make the transport mockable in tests without monkey-patching:

```typescript
// src/notifications/nodemailer-transport.token.ts
export const NODEMAILER_TRANSPORT = 'NODEMAILER_TRANSPORT';
```

Factory provider in `NotificationsModule`:
```typescript
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
}
```

Import `nodemailer` with default import:
```typescript
import nodemailer from 'nodemailer';
```
nodemailer v8 is CJS — `esModuleInterop: true` handles this. No `transformIgnorePatterns` needed (same lesson as pdfkit from Story 0.3).

### NotificationsProcessor Implementation

```typescript
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import type { Transporter } from 'nodemailer';
import { NODEMAILER_TRANSPORT } from './nodemailer-transport.token';
import { ConfigService } from '@nestjs/config';
import type { SendEmailJob } from '../queue/send-email-job.interface';

@Processor('notifications')
export class NotificationsProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsProcessor.name);

  constructor(
    @Inject(NODEMAILER_TRANSPORT) private readonly transporter: Transporter,
    private readonly config: ConfigService,
  ) { super(); }

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

  private renderTemplate(template: string, data: Record<string, unknown>): string {
    // MVP: simple HTML, no template engine
    const entries = Object.entries(data)
      .map(([k, v]) => `<tr><td><strong>${k}</strong></td><td>${String(v)}</td></tr>`)
      .join('');
    return `<h2>${template}</h2><table>${entries}</table>`;
  }
}
```

### EmailQueueService Implementation

```typescript
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
```

### Updated NotificationsModule

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import nodemailer from 'nodemailer';
import { ConfigService } from '@nestjs/config';
import { QueueModule } from '../queue/queue.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationRepository } from './notification.repository';
import { NotificationsProcessor } from './notifications.processor';
import { EmailQueueService } from './email-queue.service';
import { NOTIFICATIONS_SERVICE } from './interfaces/notification-service.interface';
import { NODEMAILER_TRANSPORT } from './nodemailer-transport.token';

@Module({
  imports: [QueueModule, ConfigModule],
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
```

### Test patterns

**NotificationsProcessor spec:**
```typescript
import { Test } from '@nestjs/testing';
import { NotificationsProcessor } from './notifications.processor';
import { NODEMAILER_TRANSPORT } from './nodemailer-transport.token';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';

describe('NotificationsProcessor', () => {
  let processor: NotificationsProcessor;
  let mockTransport: { sendMail: jest.Mock };

  beforeEach(async () => {
    mockTransport = { sendMail: jest.fn().mockResolvedValue({ messageId: 'test-id' }) };

    const module = await Test.createTestingModule({
      providers: [
        NotificationsProcessor,
        { provide: NODEMAILER_TRANSPORT, useValue: mockTransport },
        {
          provide: ConfigService,
          useValue: { get: jest.fn((key: string, def?: unknown) => def) },
        },
      ],
    }).compile();

    processor = module.get(NotificationsProcessor);
  });

  it('calls transporter.sendMail for send-email job', async () => {
    const job = {
      name: 'send-email',
      data: { to: 'test@example.com', subject: 'Test', template: 'otp', data: { code: '123456' } },
    } as Job;

    await processor.process(job);

    expect(mockTransport.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'test@example.com', subject: 'Test' }),
    );
  });

  it('does nothing for unknown job names', async () => {
    await processor.process({ name: 'unknown', data: {} } as Job);
    expect(mockTransport.sendMail).not.toHaveBeenCalled();
  });
});
```

**EmailQueueService spec:**
```typescript
it('calls queue.add with attempts:3 and exponential backoff', async () => {
  await service.sendEmail({ to: 'a@b.com', subject: 'Hello', template: 'otp', data: {} });
  expect(mockQueue.add).toHaveBeenCalledWith(
    'send-email',
    expect.objectContaining({ to: 'a@b.com' }),
    expect.objectContaining({ attempts: 3, backoff: { type: 'exponential', delay: 5000 } }),
  );
});
```

### nodenext import note

`@nestjs/bullmq` and `bullmq` are both CJS — `import { Processor, WorkerHost } from '@nestjs/bullmq'` works fine. `import { Job } from 'bullmq'` works fine.

`import type { Transporter } from 'nodemailer'` — using `import type` avoids executing the module just for the type.

### Existing patterns NOT to break

- `NotificationsModule` currently exports `NOTIFICATIONS_SERVICE` and `NotificationRepository` — keep both exports, just add `EmailQueueService`.
- `CronModule` is already in `AppModule.imports` — add `QueueModule` after it.
- `ConfigModule.forRoot({ isGlobal: true })` is in `AppModule` — all modules can use `ConfigService` without importing `ConfigModule`. The `imports: [ConfigModule]` in `NotificationsModule` is optional but explicit is fine.

### Auth service TODO (not this story)

`src/auth/auth.service.ts` has `// TODO: send OTP via email and SMS` (line 63). Wiring the OTP email through `EmailQueueService` is part of **Story 1.1**, not this story. Story 0.5 only builds the infrastructure.

### env vars added by this story

Add to `.env` (these are not yet present):
```
SMTP_HOST=smtp.ethereal.email
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
```
`EMAIL_FROM` is already in `.env`.

### Files to CREATE

- `src/queue/send-email-job.interface.ts`
- `src/notifications/nodemailer-transport.token.ts`
- `src/notifications/notifications.processor.ts`
- `src/notifications/email-queue.service.ts`
- `src/notifications/notifications.processor.spec.ts`
- `src/notifications/email-queue.service.spec.ts`

### Files to UPDATE

- `src/queue/queue.module.ts` — add `NOTIFICATIONS_QUEUE` + register queue
- `src/notifications/notifications.module.ts` — import QueueModule, add providers/exports
- `src/app.module.ts` — import `QueueModule`

### References

- Architecture §14.3 BullMQ: `_bmad-output/planning-artifacts/architecture.md`
- Epics Story 0.5: `_bmad-output/planning-artifacts/epics.md#story-05`
- Story 0.3 pattern: `_bmad-output/implementation-artifacts/0-3-pdf-service.md` (CJS default import with nodenext)
- Existing QueueModule: `src/queue/queue.module.ts`
- Existing NotificationsModule: `src/notifications/notifications.module.ts`

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

- No issues. `import nodemailer from 'nodemailer'` works with `esModuleInterop: true` and `nodenext` (CJS package, same pattern as pdfkit from Story 0.3).
- `@InjectQueue(NOTIFICATIONS_QUEUE)` requires using `getQueueToken(NOTIFICATIONS_QUEUE)` as the provider token in tests — standard `@nestjs/bullmq` pattern.
- `NotificationsProcessor extends WorkerHost` — `WorkerHost` is from `@nestjs/bullmq`, `Job` from `bullmq`. Both CJS, no import issues.

### Completion Notes List

- Added `NOTIFICATIONS_QUEUE = 'notifications'` to `src/queue/queue.module.ts` and registered the queue.
- Imported `QueueModule` in `src/app.module.ts` alongside `CronModule`.
- Created `src/queue/send-email-job.interface.ts` with `{ to, subject, template, data }` shape.
- Created `src/notifications/nodemailer-transport.token.ts` — `NODEMAILER_TRANSPORT` injection token.
- Created `src/notifications/notifications.processor.ts` — `@Processor('notifications')` WorkerHost that sends email via injected transporter, ignores unknown job names, generates minimal HTML from template+data, logs success.
- Created `src/notifications/email-queue.service.ts` — enqueues `send-email` jobs with `{ attempts: 3, backoff: { type: 'exponential', delay: 5000 } }`.
- Updated `src/notifications/notifications.module.ts` — imports QueueModule, provides transport factory, processor, and queue service, exports EmailQueueService alongside existing exports.
- 4 processor tests: sendMail called, html contains template name, unknown jobs skipped, resolves undefined.
- 3 queue service tests: add called with 'send-email', attempts+backoff correct, full dto passed through.
- All 37 tests pass (7 new + 30 pre-existing), zero TypeScript errors.
- Auth service `// TODO: send OTP via email` (line 63) intentionally left — wiring through EmailQueueService is Story 1.1's scope.

### File List

- `src/queue/queue.module.ts` — added `NOTIFICATIONS_QUEUE = 'notifications'` + registered queue
- `src/queue/send-email-job.interface.ts` — new file: SendEmailJob interface
- `src/notifications/nodemailer-transport.token.ts` — new file: NODEMAILER_TRANSPORT token
- `src/notifications/notifications.processor.ts` — new file: @Processor('notifications') WorkerHost
- `src/notifications/email-queue.service.ts` — new file: EmailQueueService with sendEmail()
- `src/notifications/notifications.module.ts` — updated: imports QueueModule, adds processor/service/transport
- `src/app.module.ts` — added QueueModule import
- `src/notifications/notifications.processor.spec.ts` — new file: 4 unit tests
- `src/notifications/email-queue.service.spec.ts` — new file: 3 unit tests
