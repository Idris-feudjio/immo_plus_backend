---
baseline_commit: aef56ef7089ecd0dc04b5df71bddd407310dc2af
---

# Story 1.6: MandateGuard pour accès Manager mandaté

Status: review

## Story

As a **developer**,
I want a MandateGuard that verifies a Manager has an active Mandate on the requested property,
So that manager access to property resources is governed by mandates, not a static managerId field.

## Acceptance Criteria

1. Non-MANAGER roles (OWNER, ADMIN, TENANT, VISITOR) bypass the guard — `canActivate` returns `true` immediately.
2. A MANAGER with no active `Mandate` (status=ACTIVE, deletedAt=null) on the `propertyId` receives HTTP 403 with message `NO_ACTIVE_MANDATE`.
3. A MANAGER with an active Mandate on the property passes — `canActivate` returns `true`.
4. `propertyId` is resolved from `request.params.propertyId ?? request.body.propertyId`.
5. If neither source provides `propertyId`, the guard returns 403 (configuration safety net).
6. `MandateGuard` is injectable via `@UseGuards(MandateGuard)` in any module — resolvable from global DI.
7. `MandateRepository.findActiveByManager(managerId, propertyId)` queries `mandates` with `status: ACTIVE, deletedAt: null`.
8. All 37 pre-existing tests continue to pass.

## Tasks / Subtasks

- [x] Task 1 — Create MandateRepository (AC: 7)
  - [x] Create `src/mandates/mandate.repository.ts` — injects `PrismaService`, implements `findActiveByManager`

- [x] Task 2 — Create MandateGuard (AC: 1, 2, 3, 4, 5)
  - [x] Create `src/common/guards/mandate.guard.ts` — `@Injectable()`, implements `CanActivate`
  - [x] Non-MANAGER roles → return true
  - [x] Resolve `propertyId` from params then body
  - [x] Missing `propertyId` → throw `ForbiddenException`
  - [x] Query `MandateRepository.findActiveByManager` → null → throw `ForbiddenException('NO_ACTIVE_MANDATE')`

- [x] Task 3 — Wire MandatesModule (AC: 6)
  - [x] Create `src/mandates/mandates.module.ts` — `@Global()`, provides+exports `MandateRepository` and `MandateGuard`
  - [x] Import `MandatesModule` in `AppModule`

- [x] Task 4 — Write tests (AC: 1–8)
  - [x] Create `src/mandates/mandate.repository.spec.ts` — 3 tests
  - [x] Create `src/common/guards/mandate.guard.spec.ts` — 9 tests (4 role bypass + 5 MANAGER scenarios)
  - [x] Full test suite: 49 tests pass (12 new + 37 pre-existing), zero regressions

## Dev Notes

### MandateRepository

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MandateStatus } from '@prisma/client';

@Injectable()
export class MandateRepository {
  constructor(private readonly prisma: PrismaService) {}

  findActiveByManager(
    managerId: string,
    propertyId: string,
  ): Promise<{ id: string } | null> {
    return this.prisma.mandate.findFirst({
      where: {
        managerId,
        propertyId,
        status: MandateStatus.ACTIVE,
        deletedAt: null,
      },
      select: { id: true },
    });
  }
}
```

### MandateGuard

```typescript
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { MandateRepository } from '../../mandates/mandate.repository';

@Injectable()
export class MandateGuard implements CanActivate {
  constructor(private readonly mandateRepository: MandateRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { user, params, body } = context.switchToHttp().getRequest<{
      user: { id: string; role: Role };
      params: Record<string, string>;
      body: Record<string, string>;
    }>();

    if (user.role !== Role.MANAGER) return true;

    const propertyId = params?.propertyId ?? body?.propertyId;
    if (!propertyId) {
      throw new ForbiddenException('MISSING_PROPERTY_ID');
    }

    const mandate = await this.mandateRepository.findActiveByManager(user.id, propertyId);
    if (!mandate) {
      throw new ForbiddenException('NO_ACTIVE_MANDATE');
    }

    return true;
  }
}
```

### MandatesModule — @Global()

`@Global()` is required so that any controller using `@UseGuards(MandateGuard)` can resolve the guard from the NestJS DI container without explicit module imports in each consumer.

```typescript
import { Global, Module } from '@nestjs/common';
import { MandateRepository } from './mandate.repository';
import { MandateGuard } from '../common/guards/mandate.guard';

@Global()
@Module({
  providers: [MandateRepository, MandateGuard],
  exports: [MandateRepository, MandateGuard],
})
export class MandatesModule {}
```

### AppModule import

```typescript
import { MandatesModule } from './mandates/mandates.module';

// In imports[]:
MandatesModule,
```

Place it alongside the other infrastructure modules (before feature modules).

### Test patterns

**mandate.repository.spec.ts:**
```typescript
it('calls prisma.mandate.findFirst with ACTIVE status and deletedAt: null', async () => {
  mockPrisma.mandate.findFirst.mockResolvedValue({ id: 'mandate-1' });
  const result = await repo.findActiveByManager('manager-1', 'property-1');
  expect(mockPrisma.mandate.findFirst).toHaveBeenCalledWith({
    where: { managerId: 'manager-1', propertyId: 'property-1', status: 'ACTIVE', deletedAt: null },
    select: { id: true },
  });
  expect(result).toEqual({ id: 'mandate-1' });
});
```

**mandate.guard.spec.ts:**
```typescript
// Non-MANAGER roles bypass
for (const role of ['OWNER', 'ADMIN', 'TENANT']) {
  it(`${role} bypasses without DB call`, async () => {
    const ctx = makeContext({ role });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(mockRepo.findActiveByManager).not.toHaveBeenCalled();
  });
}

// MANAGER + no propertyId → 403
it('throws ForbiddenException when propertyId missing', async () => {
  const ctx = makeContext({ role: 'MANAGER', params: {}, body: {} });
  await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
});

// MANAGER + no mandate → 403 NO_ACTIVE_MANDATE
it('throws ForbiddenException(NO_ACTIVE_MANDATE) when no active mandate', async () => {
  mockRepo.findActiveByManager.mockResolvedValue(null);
  const ctx = makeContext({ role: 'MANAGER', params: { propertyId: 'p-1' } });
  await expect(guard.canActivate(ctx)).rejects.toThrow('NO_ACTIVE_MANDATE');
});

// MANAGER + active mandate → passes
it('passes when manager has active mandate', async () => {
  mockRepo.findActiveByManager.mockResolvedValue({ id: 'mandate-1' });
  const ctx = makeContext({ role: 'MANAGER', params: { propertyId: 'p-1' } });
  await expect(guard.canActivate(ctx)).resolves.toBe(true);
});

// propertyId from body (not params)
it('resolves propertyId from body when not in params', async () => {
  mockRepo.findActiveByManager.mockResolvedValue({ id: 'mandate-1' });
  const ctx = makeContext({ role: 'MANAGER', params: {}, body: { propertyId: 'p-2' } });
  await expect(guard.canActivate(ctx)).resolves.toBe(true);
  expect(mockRepo.findActiveByManager).toHaveBeenCalledWith(expect.any(String), 'p-2');
});
```

### Files to CREATE

- `src/mandates/mandate.repository.ts`
- `src/mandates/mandates.module.ts`
- `src/common/guards/mandate.guard.ts`
- `src/mandates/mandate.repository.spec.ts`
- `src/common/guards/mandate.guard.spec.ts`

### Files to UPDATE

- `src/app.module.ts` — add `MandatesModule` to imports

### References

- Architecture §12.3: `_bmad-output/planning-artifacts/architecture.md`
- Epics Story 1.6: `_bmad-output/planning-artifacts/epics.md#story-16`
- Story 0.7: Phase 2 schema — `mandates` table now exists with `status`, `deletedAt`, `managerId`, `propertyId`
- Existing guards pattern: `src/common/guards/roles.guard.ts`

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

- No issues. `MandateStatus` from `@prisma/client` is available after Story 0.7 generated the Prisma client.
- `@Global()` on MandatesModule ensures `MandateGuard` is resolvable by any controller using `@UseGuards(MandateGuard)` without needing to import MandatesModule in each consuming module.

### Completion Notes List

- Created `src/mandates/mandate.repository.ts` — queries `prisma.mandate.findFirst` with `status: ACTIVE, deletedAt: null`.
- Created `src/common/guards/mandate.guard.ts` — non-MANAGER roles bypass, resolves `propertyId` from `params ?? body`, throws `ForbiddenException('NO_ACTIVE_MANDATE')` on missing mandate.
- Created `src/mandates/mandates.module.ts` — `@Global()` module exporting both `MandateRepository` and `MandateGuard`.
- Imported `MandatesModule` in `AppModule`.
- 3 repository tests (correct query shape, found result, null result) + 9 guard tests (4 role bypasses + 5 MANAGER scenarios including body fallback and params-over-body priority).
- 49 tests pass, zero TypeScript errors.

### File List

- `src/mandates/mandate.repository.ts` — new file
- `src/mandates/mandates.module.ts` — new file: @Global() module
- `src/common/guards/mandate.guard.ts` — new file: MandateGuard
- `src/mandates/mandate.repository.spec.ts` — new file: 3 unit tests
- `src/common/guards/mandate.guard.spec.ts` — new file: 9 unit tests
- `src/app.module.ts` — added MandatesModule import
