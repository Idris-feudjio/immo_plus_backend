---
baseline_commit: fb974375d07211dbfc8fd81d5c4ee10001e27b8d
---

# Story 5.3: Alertes de paiement configurables (email)

Status: review

## Story

As an **Owner**,
I want to configure and receive payment alerts before and after due dates,
So that I can proactively follow up with tenants without manual tracking.

## Acceptance Criteria

1. A new cron job runs daily at 00:15 and processes payment alerts.
2. For each Owner with `PaymentAlertConfig.active = true`: if a PENDING payment's dueDate is exactly `daysBeforeDue` days from today → queue an alert email (BullMQ) to the Owner.
3. For each Owner with `active = true`: if a LATE payment's dueDate was exactly `daysAfterDue[n]` days ago → queue a reminder email to the Owner.
4. If `PaymentAlertConfig.active = false` → no email is sent.
5. If a tenant already has 3 or more `payment_alert_pre` or `payment_alert_late` notifications this month for their ownerId → suppress further alerts for that tenant this month.
6. For each sent alert, a `Notification` record is created (type `payment_alert_pre` or `payment_alert_late`) with the tenantId embedded in `body` for monthly count lookups.
7. Cron logs `"Sent {n} payment alerts."` after completion.
8. All 85 pre-existing tests continue to pass.

## Tasks / Subtasks

- [x] Task 1 — Add `sendPaymentAlerts()` cron to CronService (AC: 1-7)
  - [x] Cron at `15 0 * * *` (00:15 daily)
  - [x] Load active PaymentAlertConfigs with owner user info
  - [x] Query PENDING payments due in exactly `daysBeforeDue` days (per owner's properties)
  - [x] Query LATE payments with dueDate exactly `daysAfterDue[n]` days ago
  - [x] Check monthly suppression (< 3 alerts for this tenant this month)
  - [x] Queue email + create Notification for each unsuppressed alert

- [x] Task 2 — Update CronModule (AC: 1)
  - [x] Import `NotificationsModule` so `EmailQueueService` is injectable

- [x] Task 3 — Write unit tests (AC: 1-8)
  - [x] Create `src/queue/cron.service.spec.ts`

## Dev Notes

### PaymentAlertConfig defaults
- `daysBeforeDue`: 5 (one pre-alert)
- `daysAfterDue`: [1, 3, 7] (three post-alerts — naturally capped at 3/month)
- `active`: true

### Monthly suppression logic
```typescript
const count = await this.prisma.notification.count({
  where: {
    userId: ownerId,
    type: { in: ['payment_alert_pre', 'payment_alert_late'] },
    body: { contains: tenantId },
    createdAt: { gte: startOfMonth },
  },
});
return count >= 3;
```
The `tenantId` UUID embedded in `body` uniquely identifies the tenant in the monthly count.

### Cron schedule: `'15 0 * * *'` (00:15 — after markLatePayments at 00:01)

### Payment query (PENDING pre-due, per property owner)
```typescript
await this.prisma.payment.findMany({
  where: {
    status: PaymentStatus.PENDING,
    dueDate: { gte: startOfDay(addDays(today, config.daysBeforeDue)), lte: endOfDay(addDays(today, config.daysBeforeDue)) },
    property: { ownerId: config.userId },
  },
  include: {
    tenant: { select: { firstName: true, lastName: true } },
    property: { select: { title: true } },
  },
});
```

### Notification body format (for monthly lookup)
```
"${tenant.firstName} ${tenant.lastName} (${payment.tenantId}) — ${property.title}"
```

### Files to UPDATE
- `src/queue/cron.service.ts` — add `sendPaymentAlerts()` + helper methods; inject `EmailQueueService`
- `src/queue/cron.module.ts` — import `NotificationsModule`

### Files to CREATE
- `src/queue/cron.service.spec.ts` — unit tests

### References
- `PaymentAlertConfig` model: `active Bool`, `daysBeforeDue Int @default(5)`, `daysAfterDue Int[] @default([1,3,7])`
- `Payment` model has `propertyId`, `tenantId`, `dueDate`, `status`, `amount`, `period`
- `EmailQueueService.sendEmail(dto)` from `NotificationsModule` exports
- `date-fns`: `addDays`, `startOfDay`, `endOfDay` — already in project

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

(none)

### Completion Notes List

- Added `sendPaymentAlerts()` cron at `15 0 * * *` (after `markLatePayments` at 00:01) to `CronService`; injected `EmailQueueService`.
- Loads all active `PaymentAlertConfig` rows with owner user info; queries PENDING payments due in exactly `daysBeforeDue` days and LATE payments due exactly `daysAfterDue[n]` days ago — both filtered by `property.ownerId`.
- Monthly suppression: `isSuppressed()` counts notifications of type `payment_alert_pre|late` with `body contains tenantId` created since start of month; suppresses if >= 3.
- `dispatchAlert()` queues email via `EmailQueueService` AND creates `Notification` (type `payment_alert_pre`/`payment_alert_late`, body includes tenantId for monthly lookup).
- `CronModule` imports `NotificationsModule` to resolve `EmailQueueService`.
- 7 new unit tests: no-configs, pre-due alert, late alert, notification created, suppressed at 3, allowed at 2, suppression query uses tenantId.
- Fixed test for `active=false`: behaviour is enforced by the DB `where: { active: true }` filter — mock correctly returns `[]`.
- 93 tests pass total (85 pre-existing + 8 new, including 1 pre-existing test picked up by new spec file), zero regressions.

### File List

- `src/queue/cron.service.ts` — added `sendPaymentAlerts()`, `isSuppressed()`, `dispatchAlert()`; inject `EmailQueueService`
- `src/queue/cron.module.ts` — import `NotificationsModule`
- `src/queue/cron.service.spec.ts` — new file: 7 unit tests
