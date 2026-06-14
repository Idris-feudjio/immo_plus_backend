---
baseline_commit: a75bd25
---

# Story 10.1: Secure OTP & Reset Token Delivery

Status: ready-for-dev

## Story

As a **system operator**,
I want OTP codes and password-reset links delivered via the email queue instead of `console.log`,
So that sensitive tokens are never exposed in application logs or CI/CD pipelines.

## Acceptance Criteria

1. `AuthService.register()` enqueues an email job via `EmailQueueService`; no OTP value appears in any log line.
2. `AuthService.resendOtp()` enqueues an email job; no OTP value appears in any log line.
3. `AuthService.forgotPassword()` enqueues an email job; no reset URL appears in any log line.
4. When `SMTP_*` environment variables are absent, the email job is enqueued and silently no-ops (BullMQ handles this via the no-op queue when `REDIS_ENABLED=false`).
5. `AuthModule` correctly imports `NotificationsModule` so `EmailQueueService` is resolvable.
6. All existing tests continue to pass (currently 0 auth.service tests — confirmed by audit).

## Tasks / Subtasks

- [ ] Task 1 — Import NotificationsModule into AuthModule (AC: 5)
  - [ ] Add `NotificationsModule` to `AuthModule.imports[]` in `src/auth/auth.module.ts`

- [ ] Task 2 — Inject EmailQueueService into AuthService (AC: 1, 2, 3)
  - [ ] Add `private emailQueue: EmailQueueService` to `AuthService` constructor
  - [ ] Add the import for `EmailQueueService` from `'../notifications/email-queue.service.js'`

- [ ] Task 3 — Replace console.log in register() (AC: 1)
  - [ ] Remove line 69: `console.log(\`OTP for ${user.email}: ${otp}\`)`
  - [ ] Add `await this.emailQueue.sendEmail(...)` call with OTP job shape

- [ ] Task 4 — Replace console.log in resendOtp() (AC: 2)
  - [ ] Remove line 125: `console.log(\`Resend OTP for ${user.email}: ${otp}\`)`
  - [ ] Add `await this.emailQueue.sendEmail(...)` call with OTP job shape

- [ ] Task 5 — Replace console.log in forgotPassword() (AC: 3)
  - [ ] Remove line 185: `console.log(\`Reset link: ...\`)`
  - [ ] Add `await this.emailQueue.sendEmail(...)` call with password-reset job shape

- [ ] Task 6 — Verify no sensitive data leaks (AC: 1, 2, 3, 4)
  - [ ] Search codebase for any remaining `console.log` containing OTP or token values
  - [ ] Confirm `REDIS_ENABLED=false` path silently discards jobs (no stdout)

## Dev Notes

### Context

This story fixes **Audit finding C1** — three `console.log` calls in `auth.service.ts` expose OTP codes and reset URLs in plain text wherever the application writes stdout (CI logs, PM2, cloud log aggregators, etc.).

**Scope:** 2 files modified. No new files. No schema changes. No new dependencies.

---

### Files to Modify

#### 1. `src/auth/auth.module.ts`

**Current state:**
```typescript
@Module({
  imports: [PassportModule, JwtModule.registerAsync(...)],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [JwtModule],
})
export class AuthModule {}
```

**Required change — add `NotificationsModule` to imports:**
```typescript
import { NotificationsModule } from '../notifications/notifications.module.js';

@Module({
  imports: [PassportModule, JwtModule.registerAsync(...), NotificationsModule],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [JwtModule],
})
export class AuthModule {}
```

`NotificationsModule` already exports `EmailQueueService` — confirmed in `src/notifications/notifications.module.ts` exports array. No circular dependency risk: `NotificationsModule` does not import `AuthModule`.

---

#### 2. `src/auth/auth.service.ts`

**Current constructor (line 19-24):**
```typescript
constructor(
  private prisma: PrismaService,
  private jwt: JwtService,
  private config: ConfigService,
) {}
```

**New constructor — add EmailQueueService:**
```typescript
import { EmailQueueService } from '../notifications/email-queue.service.js';

constructor(
  private prisma: PrismaService,
  private jwt: JwtService,
  private config: ConfigService,
  private emailQueue: EmailQueueService,
) {}
```

---

### The 3 console.log Replacements

#### Replacement 1 — `register()` at line 69

Remove:
```typescript
// TODO: send OTP via email and SMS
console.log(`OTP for ${user.email}: ${otp}`);
```

Replace with:
```typescript
await this.emailQueue.sendEmail({
  to: user.email,
  subject: 'Votre code de vérification Immo Plus CM',
  template: 'otp',
  data: { name: user.firstName, otp },
});
```

#### Replacement 2 — `resendOtp()` at line 125

Remove:
```typescript
console.log(`Resend OTP for ${user.email}: ${otp}`);
```

Replace with:
```typescript
await this.emailQueue.sendEmail({
  to: user.email,
  subject: 'Votre nouveau code de vérification Immo Plus CM',
  template: 'otp',
  data: { name: user.firstName, otp },
});
```

Note: `resendOtp()` currently only has `userId`, not the full user object. The user is already fetched at line 109 (`const user = ...`). Use `user.email` and `user.firstName` from that existing fetch.

#### Replacement 3 — `forgotPassword()` at line 185

Remove:
```typescript
console.log(`Reset link: ${this.config.get('FRONTEND_URL')}/reset-password?token=${token}`);
```

Replace with:
```typescript
await this.emailQueue.sendEmail({
  to: user.email,
  subject: 'Réinitialisation de votre mot de passe Immo Plus CM',
  template: 'password-reset',
  data: {
    name: user.firstName,
    resetUrl: `${this.config.get('FRONTEND_URL')}/reset-password?token=${token}`,
  },
});
```

---

### SendEmailJob Interface (reference)

```typescript
// src/queue/send-email-job.interface.ts
export interface SendEmailJob {
  to: string;
  subject: string;
  template: string;   // 'otp' | 'password-reset' (templates created in Story 14.1)
  data: Record<string, unknown>;
}
```

`EmailQueueService.sendEmail()` is already configured with `{ attempts: 3, backoff: { type: 'exponential', delay: 5000 } }` — no need to pass job options.

---

### REDIS_ENABLED=false Behavior (AC: 4)

When `REDIS_ENABLED=false` (current `.env` setting), `QueueModule` provides a no-op queue token:
```typescript
const noOpQueue = { add: () => Promise.resolve(null), addBulk: () => Promise.resolve([]) };
```

`EmailQueueService.sendEmail()` calls `this.queue.add(...)` which resolves to `null` silently. **No stdout, no error, no sensitive data.** This is correct behavior per AC-4.

When `REDIS_ENABLED=true` (production), the BullMQ job is enqueued and `NotificationsProcessor` sends the email via nodemailer.

---

### Template Names (forward-compatibility with Story 14.1)

Use these template string values — they must match what Story 14.1 (EP-14) will create in `src/notifications/templates/`:
- `'otp'` → `src/notifications/templates/otp.html`
- `'password-reset'` → `src/notifications/templates/password-reset.html`

`NotificationsProcessor` currently handles jobs by template name. Until Story 14.1 is implemented, the processor will receive the job but may fall back to a plain-text email or log a warning — this is acceptable. **Do NOT block this story on EP-14 completion.**

---

### Anti-patterns to Avoid

```typescript
// ❌ NEVER — sensitive data in Logger
this.logger.log(`OTP: ${otp}`);
this.logger.debug(`Reset token: ${token}`);

// ❌ NEVER — re-add console.log as fallback
try {
  await this.emailQueue.sendEmail(...);
} catch {
  console.log(`OTP: ${otp}`); // FORBIDDEN
}

// ❌ NEVER — call NotificationsService directly (wrong layer)
await this.notificationsService.create({ ... });

// ✅ CORRECT — fire and forget is acceptable for email queue
await this.emailQueue.sendEmail({ to, subject, template, data });
// The promise resolves when job is enqueued, not when email is sent
```

---

### Import Path Convention (TypeScript nodenext)

```typescript
// ✅ Correct — nodenext requires .js extension on all relative imports
import { EmailQueueService } from '../notifications/email-queue.service.js';
import { NotificationsModule } from '../notifications/notifications.module.js';

// ❌ Wrong — missing .js extension
import { EmailQueueService } from '../notifications/email-queue.service';
```

---

### Verification After Implementation

Run these to confirm no leaks remain:
```bash
# Should return 0 results after the fix
grep -n "console.log" src/auth/auth.service.ts

# TypeScript must compile cleanly
npx tsc --noEmit

# Existing tests must pass
npx jest --passWithNoTests
```

## File List

- `src/auth/auth.module.ts` — MODIFY (add NotificationsModule import)
- `src/auth/auth.service.ts` — MODIFY (inject EmailQueueService, replace 3 console.log)
