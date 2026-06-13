---
baseline_commit: fb974375d07211dbfc8fd81d5c4ee10001e27b8d
---

# Story 2.8: Candidature locative (portail public)

Status: review

## Story

As a **Visitor**,
I want to submit a rental application on a published property without creating an account,
So that I can express interest in a property immediately.

## Acceptance Criteria

1. `POST /api/applications` is public (`@Public()`) — no authentication required.
2. Body requires: `firstName`, `lastName`, `email`, `phone`, `propertyId`, optional `message`.
3. If `propertyId` refers to a published, non-deleted property → create `Application` with `status=PENDING`, return HTTP 201 `{ applicationId, status: 'PENDING' }`.
4. An in-app `Notification` is created for the property's Owner; if a Manager is assigned, one is also created for the Manager.
5. An email job is queued via BullMQ (`EmailQueueService`) to the Owner (and Manager if assigned) with the applicant's details.
6. If `propertyId` refers to a non-published or non-existent property → HTTP 404.
7. The `Application` model has `firstName`, `lastName`, `email`, `phone` fields (migration required).
8. All 60 pre-existing tests continue to pass.

## Tasks / Subtasks

- [x] Task 1 — Prisma schema + migration (AC: 7)
  - [x] Add `firstName`, `lastName`, `email`, `phone` to `Application` model in schema.prisma
  - [x] Run `prisma migrate dev --name add_application_contact_fields`

- [x] Task 2 — Create ApplicationsModule (AC: 1-6)
  - [x] Create `src/applications/applications.service.ts`
  - [x] Create `src/applications/applications.controller.ts`
  - [x] Create `src/applications/applications.module.ts`
  - [x] Import `ApplicationsModule` in `AppModule`

- [x] Task 3 — Write unit tests (AC: 1-8)
  - [x] Create `src/applications/applications.service.spec.ts`

## Dev Notes

### Schema change

Add to `Application` model (after `id` line):
```prisma
firstName  String  @db.VarChar(100)
lastName   String  @db.VarChar(100)
email      String  @db.VarChar(255)
phone      String? @db.VarChar(20)
```

### ApplicationsService logic

```typescript
async submit(dto: SubmitApplicationDto) {
  // 1. Verify property exists and is published
  const property = await this.prisma.property.findFirst({
    where: { id: dto.propertyId, isPublished: true, deletedAt: null },
    select: {
      id: true, title: true, city: true,
      owner: { select: { id: true, email: true, firstName: true, lastName: true } },
      manager: { select: { id: true, email: true, firstName: true, lastName: true } },
    },
  });
  if (!property) throw new NotFoundException('PROPERTY_NOT_FOUND');

  // 2. Create application
  const application = await this.prisma.application.create({
    data: {
      propertyId: dto.propertyId,
      firstName: dto.firstName,
      lastName: dto.lastName,
      email: dto.email,
      phone: dto.phone,
      message: dto.message,
    },
    select: { id: true, status: true },
  });

  // 3. Collect recipients (owner always, manager if assigned)
  const recipients = [property.owner];
  if (property.manager) recipients.push(property.manager);

  // 4. In-app notifications + email queue (fire and forget)
  const notifTitle = `Nouvelle candidature — ${property.title}`;
  const notifBody = `${dto.firstName} ${dto.lastName} a soumis une candidature pour ${property.title} (${property.city}).`;

  await Promise.all(
    recipients.flatMap((r) => [
      this.notificationRepo.create({
        userId: r.id,
        type: 'NEW_APPLICATION',
        title: notifTitle,
        body: notifBody,
      }),
      this.emailQueue.sendEmail({
        to: r.email,
        subject: notifTitle,
        template: 'new-application',
        data: {
          recipientName: `${r.firstName} ${r.lastName}`,
          applicantName: `${dto.firstName} ${dto.lastName}`,
          applicantEmail: dto.email,
          applicantPhone: dto.phone ?? '',
          propertyTitle: property.title,
          message: dto.message ?? '',
        },
      }),
    ]),
  );

  return { applicationId: application.id, status: application.status };
}
```

### DTO

```typescript
export class SubmitApplicationDto {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  propertyId: string;
  message?: string;
}
```

### Files to CREATE

- `src/applications/applications.service.ts`
- `src/applications/applications.controller.ts`
- `src/applications/applications.module.ts`
- `src/applications/applications.service.spec.ts`

### Files to UPDATE

- `prisma/schema.prisma` — add fields to Application model
- `src/app.module.ts` — import ApplicationsModule

### References

- `NotificationsModule` exports `NotificationRepository` and `EmailQueueService` — import NotificationsModule in ApplicationsModule
- `@Public()` decorator: `src/common/decorators/public.decorator.ts`
- Property model: `isPublished: Boolean`, `deletedAt: DateTime?`, `ownerId String`, `managerId String?`
- `ApplicationStatus.PENDING` is the default — no need to set it explicitly

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

(none)

### Completion Notes List

- Added `firstName`, `lastName`, `email`, `phone?` to `Application` model in schema.prisma; migration `20260613151933_add_application_contact_fields` applied.
- `ApplicationsService.submit()`: finds property with `isPublished: true, deletedAt: null` (404 if missing); creates `Application`; builds recipient list (owner always + manager if assigned); fires `notificationRepo.create()` + `emailQueue.sendEmail()` in parallel for each recipient.
- Controller: `POST /applications` with `@Public()` and `@HttpCode(201)`.
- `ApplicationsModule` imports `NotificationsModule` to get `NotificationRepository` and `EmailQueueService` providers.
- 8 new unit tests: success result, property query shape, DTO persisted correctly, 404 on missing property, owner notification, owner email, manager notified when assigned, manager NOT notified when absent.
- 68 tests pass total (60 pre-existing + 8 new), zero regressions.

### File List

- `prisma/schema.prisma` — added firstName/lastName/email/phone to Application model
- `prisma/migrations/20260613151933_add_application_contact_fields/migration.sql` — new migration
- `src/applications/applications.service.ts` — new file
- `src/applications/applications.controller.ts` — new file
- `src/applications/applications.module.ts` — new file
- `src/applications/applications.service.spec.ts` — new file: 8 unit tests
- `src/app.module.ts` — added ApplicationsModule import
