---
baseline_commit: fb974375d07211dbfc8fd81d5c4ee10001e27b8d
---

# Story 1.7: Admin — User Listing & Deactivation

Status: review

## Story

As an **admin**,
I want to list all platform users with filters and deactivate a specific user,
So that I can manage user access from the back-office.

## Acceptance Criteria

1. `GET /api/admin/users` returns a paginated list of users (default limit 10, max 100).
2. `page` and `limit` query params control pagination; response includes `total`, `page`, `limit`, `data`.
3. Optional filter `role` narrows results to users with that Role enum value.
4. Optional filter `isActive` (boolean) filters by active/inactive status.
5. Optional filter `search` performs a case-insensitive `contains` search on `firstName`, `lastName`, and `email` (OR).
6. `passwordHash` is NEVER returned in any response.
7. `PATCH /api/admin/users/:id/deactivate` sets `isActive: false` and returns HTTP 200 with the updated user (without `passwordHash`).
8. Deactivating a non-existent user returns HTTP 404.
9. Both endpoints require `Role.ADMIN` (inherited from `@Roles(Role.ADMIN)` on the controller class).
10. All 49 pre-existing tests continue to pass.

## Tasks / Subtasks

- [x] Task 1 — Extend IAdminService interface (AC: 1, 7)
  - [x] Add `listUsers(query: ListUsersQuery): Promise<PaginatedUsersResult>` to IAdminService
  - [x] Add `deactivateUser(id: string): Promise<UserWithoutHash>` to IAdminService

- [x] Task 2 — Implement AdminService methods (AC: 1-8)
  - [x] Implement `listUsers` with pagination + filters (role, isActive, search)
  - [x] Implement `deactivateUser` — update isActive=false, throw NotFoundException if not found
  - [x] Select all User fields except `passwordHash` in both methods

- [x] Task 3 — Add controller endpoints (AC: 9)
  - [x] `GET /users` → `listUsers` with query params parsed via `@Query()`
  - [x] `PATCH /users/:id/deactivate` → `deactivateUser` with `@Param('id')`

- [x] Task 4 — Write unit tests (AC: 1-10)
  - [x] Create `src/admin/admin.service.spec.ts` — 8+ tests covering pagination, each filter, combined filters, deactivate success, deactivate 404

## Dev Notes

### User select shape (no passwordHash)

```typescript
const USER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  role: true,
  avatarUrl: true,
  emailVerified: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;
```

### listUsers query interface

```typescript
interface ListUsersQuery {
  page?: number;      // default 1
  limit?: number;     // default 10
  role?: Role;
  isActive?: boolean;
  search?: string;
}
```

### AdminService.listUsers

```typescript
async listUsers(query: ListUsersQuery) {
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(100, Math.max(1, query.limit ?? 10));
  const skip = (page - 1) * limit;

  const where: Prisma.UserWhereInput = {};
  if (query.role !== undefined) where.role = query.role;
  if (query.isActive !== undefined) where.isActive = query.isActive;
  if (query.search) {
    where.OR = [
      { firstName: { contains: query.search, mode: 'insensitive' } },
      { lastName: { contains: query.search, mode: 'insensitive' } },
      { email: { contains: query.search, mode: 'insensitive' } },
    ];
  }

  const [data, total] = await Promise.all([
    this.prisma.user.findMany({ where, skip, take: limit, select: USER_SELECT, orderBy: { createdAt: 'desc' } }),
    this.prisma.user.count({ where }),
  ]);

  return { data, total, page, limit };
}
```

### AdminService.deactivateUser

```typescript
async deactivateUser(id: string) {
  const user = await this.prisma.user.findUnique({ where: { id }, select: { id: true } });
  if (!user) throw new NotFoundException('USER_NOT_FOUND');
  return this.prisma.user.update({
    where: { id },
    data: { isActive: false },
    select: USER_SELECT,
  });
}
```

### Controller additions

```typescript
@Get('users')
@ApiOperation({ summary: 'Liste paginée des utilisateurs (admin)' })
listUsers(
  @Query('page') page?: string,
  @Query('limit') limit?: string,
  @Query('role') role?: Role,
  @Query('isActive') isActive?: string,
  @Query('search') search?: string,
) {
  return this.service.listUsers({
    page: page ? parseInt(page, 10) : undefined,
    limit: limit ? parseInt(limit, 10) : undefined,
    role,
    isActive: isActive !== undefined ? isActive === 'true' : undefined,
    search,
  });
}

@Patch('users/:id/deactivate')
@HttpCode(HttpStatus.OK)
@ApiOperation({ summary: 'Désactiver un utilisateur' })
deactivateUser(@Param('id') id: string) {
  return this.service.deactivateUser(id);
}
```

### Files to UPDATE

- `src/admin/interfaces/admin-service.interface.ts` — add listUsers, deactivateUser signatures
- `src/admin/admin.service.ts` — implement both methods
- `src/admin/admin.controller.ts` — add GET /users and PATCH /users/:id/deactivate

### Files to CREATE

- `src/admin/admin.service.spec.ts` — unit tests for listUsers and deactivateUser

### References

- Architecture §8 (Admin endpoints): `_bmad-output/planning-artifacts/architecture.md`
- User model: `prisma/schema.prisma` — fields: id, firstName, lastName, email, phone, role, avatarUrl, emailVerified, isActive, createdAt, updatedAt, passwordHash
- Pattern: `AdminService` injects `PrismaService` directly (no repository layer for admin)

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

(none)

### Completion Notes List

- Extended `IAdminService` with `ListUsersQuery` interface + `listUsers` and `deactivateUser` method signatures.
- `listUsers`: pagination (page/limit with clamp to 100 max), optional filters (role, isActive, search OR across firstName/lastName/email), parallel `findMany` + `count`, `orderBy: createdAt desc`. Never returns `passwordHash` via explicit `USER_SELECT` constant.
- `deactivateUser`: checks existence first (throws `NotFoundException('USER_NOT_FOUND')` if missing), then updates `isActive: false`, returns user via `USER_SELECT`.
- Controller: `GET /admin/users` with 5 `@Query()` params (page/limit parsed as int, isActive as boolean string), `PATCH /admin/users/:id/deactivate` with `@HttpCode(200)`.
- 11 new unit tests in `admin.service.spec.ts`: 8 for `listUsers` (defaults, explicit page/limit, limit clamp, role filter, isActive filter, search OR, no passwordHash, parallel calls) + 3 for `deactivateUser` (success, 404, no passwordHash).
- 60 tests pass total (49 pre-existing + 11 new), zero regressions.

### File List

- `src/admin/interfaces/admin-service.interface.ts` — added `ListUsersQuery` + `listUsers`/`deactivateUser` to `IAdminService`
- `src/admin/admin.service.ts` — implemented `listUsers` and `deactivateUser` with `USER_SELECT` constant
- `src/admin/admin.controller.ts` — added `GET /users` and `PATCH /users/:id/deactivate`
- `src/admin/admin.service.spec.ts` — new file: 11 unit tests
