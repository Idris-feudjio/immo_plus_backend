---
baseline_commit: fb974375d07211dbfc8fd81d5c4ee10001e27b8d
---

# Story 5.5: Téléchargement de la quittance PDF

Status: review

## Story

As a **Tenant / Owner / Admin**,
I want to download a receipt PDF for a paid payment,
So that I can obtain proof of payment.

## Acceptance Criteria

1. `GET /payments/:id/receipt` — if payment status is PAID and authenticated as the Tenant (linked contract) or Owner/Admin → HTTP 200 returns `{ receiptUrl }` (pre-signed URL from R2, 1h expiry = 3600s).
2. If payment status is NOT PAID → HTTP 409 with error code `PAYMENT_NOT_PAID`.
3. If payment not found → HTTP 404.
4. If user is not authorized (not owner/admin and not the linked tenant) → HTTP 403.
5. TENANT role: tenant linked to the payment (via `payment.tenantId === tenant.id` where tenant is found by `userId`) can access the receipt.
6. OWNER/MANAGER/ADMIN: use existing `findPaymentWithPropertyOrThrow` authorization.
7. `receiptUrl` returned is a **pre-signed URL** (not the raw R2 URL), valid for 3600 seconds.
8. All pre-existing tests continue to pass.

## Tasks / Subtasks

- [x] Task 1 — Add `findTenantByUserId(userId: string)` to `PaymentRepository` (AC: 5)
- [x] Task 2 — Update `PaymentsService.getReceiptUrl()` (AC: 1-7)
  - [x] Inject `StorageService`
  - [x] Handle TENANT role: findTenantByUserId, check tenantId match, 403 if not matched
  - [x] Check `payment.status === PAID` → 409 ConflictException('PAYMENT_NOT_PAID') if not
  - [x] Check `receiptUrl` exists → 404 if absent
  - [x] Return `getSignedUrl(keyFromUrl(receiptUrl), 3600)`
- [x] Task 3 — Write unit tests (AC: 1-8)
  - [x] Create `src/payments/payments.service.spec.ts`

## Dev Notes

### Authorization logic
- TENANT: `findPaymentById(id)` → `findTenantByUserId(userId)` → check `payment.tenantId === tenant.id` → 403 if not
- OWNER/MANAGER/ADMIN: `findPaymentWithPropertyOrThrow(id, userId, role)` (existing method)
- Note: `findPaymentWithPropertyOrThrow` checks `property.ownerId === userId || property.managerId === userId` for non-ADMIN

### StorageService (global — no PaymentsModule changes needed)
- `keyFromUrl(url: string): string` — extracts R2 key from stored URL
- `getSignedUrl(key: string, expiresIn: number): Promise<string>` — returns pre-signed URL

### Payment model fields used
- `status: PaymentStatus` — must be `PAID`
- `receiptUrl: string | null` — stored R2 public URL (set when payment is marked PAID with PDF)
- `tenantId: string` — links to `Tenant.id`

### Files to UPDATE
- `src/payments/payment.repository.ts` — add `findTenantByUserId`
- `src/payments/payments.service.ts` — inject StorageService, replace getReceiptUrl stub

### Files to CREATE
- `src/payments/payments.service.spec.ts` — unit tests

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

(none)

### Completion Notes List

- Added `findTenantByUserId(userId)` to `PaymentRepository` (delegates to `prisma.tenant.findFirst({ where: { userId } })`).
- `PaymentsService.getReceiptUrl` now handles two auth paths: TENANT (find tenant by userId, verify tenantId match) and OWNER/MANAGER/ADMIN (existing `findPaymentWithPropertyOrThrow`).
- 409 `ConflictException('PAYMENT_NOT_PAID')` thrown when `payment.status !== PAID`; 404 when `receiptUrl` is null.
- Pre-signed URL returned via `StorageService.keyFromUrl(receiptUrl)` + `getSignedUrl(key, 3600)` (1h TTL).
- `StorageModule` is `@Global()` so no `PaymentsModule` import change needed — only constructor injection added.
- 11 new unit tests covering: OWNER success, OWNER 409/404, ADMIN pass-through, TENANT success, TENANT 403 (wrong tenant), TENANT 403 (no tenant record), TENANT 404, TENANT 409, TTL verification.
- 104 tests pass total (93 pre-existing + 11 new), zero regressions.

### File List

- `src/payments/payment.repository.ts`
- `src/payments/payments.service.ts`
- `src/payments/payments.service.spec.ts`
