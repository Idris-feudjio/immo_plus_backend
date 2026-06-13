---
baseline_commit: fb974375d07211dbfc8fd81d5c4ee10001e27b8d
---

# Story 2.9: Traitement des candidatures (back-office Owner/Manager)

Status: review

## Story

As an **Owner or mandated Manager**,
I want to review and process rental applications,
So that I can accept or reject candidates efficiently.

## Acceptance Criteria

1. `GET /api/applications?propertyId=:id` returns paginated applications for that property.
2. An OWNER may only list applications for properties they own (`property.ownerId === user.id`); otherwise HTTP 403.
3. A MANAGER may only list applications for properties where they have an active Mandate; otherwise HTTP 403 `NO_ACTIVE_MANDATE`.
4. ADMIN bypasses ownership/mandate checks.
5. Optional `status` query param (`PENDING`|`ACCEPTED`|`REJECTED`) filters the list.
6. Optional `page` / `limit` control pagination (defaults 1 / 20).
7. `PATCH /api/applications/:id/accept` sets `status=ACCEPTED`, returns HTTP 200 with the updated application.
8. `PATCH /api/applications/:id/reject` sets `status=REJECTED`, returns HTTP 200 with the updated application.
9. Both PATCH endpoints enforce the same ownership/mandate authorization as the GET endpoint.
10. Non-existent application on PATCH → HTTP 404.
11. All 68 pre-existing tests continue to pass.

## Tasks / Subtasks

- [x] Task 1 — Extend ApplicationsService (AC: 1-10)
  - [x] Add `listForProperty(user, query)` — paginated list with property auth check
  - [x] Add `updateStatus(user, id, status)` — accept/reject with same auth logic
  - [x] Inject `MandateRepository` (global provider, no module import change needed)

- [x] Task 2 — Add controller endpoints (AC: 1-10)
  - [x] `GET /applications` → `listForProperty`
  - [x] `PATCH /applications/:id/accept` → `updateStatus(..., ACCEPTED)`
  - [x] `PATCH /applications/:id/reject` → `updateStatus(..., REJECTED)`

- [x] Task 3 — Write unit tests (AC: 1-11)
  - [x] Tests in `src/applications/applications.service.spec.ts`

## Dev Notes

### Auth logic (shared between list and update)

```typescript
private async authorizeProperty(user: AuthUser, propertyId: string) {
  const property = await this.prisma.property.findFirst({
    where: { id: propertyId, deletedAt: null },
    select: { id: true, ownerId: true },
  });
  if (!property) throw new NotFoundException('PROPERTY_NOT_FOUND');

  if (user.role === Role.OWNER && property.ownerId !== user.id) {
    throw new ForbiddenException('NOT_PROPERTY_OWNER');
  }
  if (user.role === Role.MANAGER) {
    const mandate = await this.mandateRepo.findActiveByManager(user.id, propertyId);
    if (!mandate) throw new ForbiddenException('NO_ACTIVE_MANDATE');
  }
  return property;
}
```

### listForProperty

```typescript
async listForProperty(user: AuthUser, query: ListApplicationsQuery) {
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(100, Math.max(1, query.limit ?? 20));
  await this.authorizeProperty(user, query.propertyId);

  const where: Prisma.ApplicationWhereInput = { propertyId: query.propertyId };
  if (query.status) where.status = query.status;

  const [data, total] = await Promise.all([
    this.prisma.application.findMany({ where, skip: (page-1)*limit, take: limit, orderBy: { createdAt: 'desc' } }),
    this.prisma.application.count({ where }),
  ]);
  return { data, total, page, limit };
}
```

### updateStatus

```typescript
async updateStatus(user: AuthUser, id: string, status: ApplicationStatus) {
  const application = await this.prisma.application.findUnique({
    where: { id }, select: { id: true, propertyId: true },
  });
  if (!application) throw new NotFoundException('APPLICATION_NOT_FOUND');
  await this.authorizeProperty(user, application.propertyId);
  return this.prisma.application.update({ where: { id }, data: { status } });
}
```

### MandateRepository injection

`MandatesModule` is `@Global()` — inject `MandateRepository` in `ApplicationsService` constructor directly, no changes to `ApplicationsModule.imports`.

### Files to UPDATE

- `src/applications/applications.service.ts` — add `listForProperty`, `updateStatus`, inject `MandateRepository`
- `src/applications/applications.controller.ts` — add GET /applications and two PATCH endpoints
- `src/applications/applications.service.spec.ts` — add tests for new methods

### References

- `MandateRepository.findActiveByManager(managerId, propertyId)`: `src/mandates/mandate.repository.ts`
- `AuthUser` interface: `src/common/interfaces/auth-user.interface.ts`
- `@CurrentUser()` decorator: `src/common/decorators/current-user.decorator.ts`
- `ApplicationStatus` enum: PENDING | ACCEPTED | REJECTED (from `@prisma/client`)

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

(none)

### Completion Notes List

- Added `listForProperty(user, query)` and `updateStatus(user, id, status)` to `ApplicationsService`; shared `authorizeProperty()` private helper enforces OWNER ownership check and MANAGER mandate check (`MandateRepository.findActiveByManager`), ADMIN bypasses both.
- `MandateRepository` injected via `MandatesModule` (`@Global()`) — no changes to `ApplicationsModule.imports`.
- Controller adds `GET /applications` (queries `propertyId`, `status`, `page`, `limit`) and `PATCH /applications/:id/accept` + `PATCH /applications/:id/reject` all requiring `@Roles(OWNER, MANAGER, ADMIN)`.
- 12 new unit tests: 7 for `listForProperty` (OWNER success, ADMIN bypass, MANAGER with mandate, OWNER 403, MANAGER 403, 404 missing property, status filter) + 5 for `updateStatus` (accept, reject, 404, OWNER 403, MANAGER 403).
- 80 tests pass total (68 pre-existing + 12 new), zero regressions.

### File List

- `src/applications/applications.service.ts` — added `listForProperty`, `updateStatus`, `authorizeProperty`; inject `MandateRepository`
- `src/applications/applications.controller.ts` — added `GET /applications`, `PATCH /:id/accept`, `PATCH /:id/reject`
- `src/applications/applications.service.spec.ts` — expanded: 20 tests total (8 submit + 7 list + 5 update)
