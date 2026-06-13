---
baseline_commit: fb974375d07211dbfc8fd81d5c4ee10001e27b8d
---

# Story 4.5: Génération PDF du contrat (synchrone)

Status: review

## Story

As an **Owner**,
I want to download a PDF of my contract on demand,
So that I have a formal document for the tenant to sign.

## Acceptance Criteria

1. `GET /api/contracts/:id/pdf` returns `{ pdfUrl }` — already wired in the controller.
2. If `Contract.pdfUrl` is already set and `?force` is absent/false → return the existing `pdfUrl` immediately (no re-generation).
3. If `Contract.pdfUrl` is null OR `?force=true` → generate the PDF synchronously with `PdfService.generateContractPdf()`.
4. The generated PDF includes: owner name, tenant name + national ID, property address/city/title, period (startDate–endDate), rent HT, TVA 19.25%, rent TTC, fees, deposit, and all contract clauses.
5. The PDF buffer is uploaded to R2 via `StorageService.uploadBuffer()` at key `contracts/{contractId}/contract.pdf`, `application/pdf`.
6. `Contract.pdfUrl` is updated in the database after upload.
7. HTTP 200 returns `{ pdfUrl: string }` (the R2 public URL).
8. All 80 pre-existing tests continue to pass.

## Tasks / Subtasks

- [x] Task 1 — Extend ContractRepository (AC: 3-6)
  - [x] Add `findByIdForPdf(id)` — includes property.owner, tenant, clauses
  - [x] Add `updatePdfUrl(id, pdfUrl)` — updates Contract.pdfUrl

- [x] Task 2 — Update ContractsService.getPdfUrl (AC: 2-7)
  - [x] Inject `PdfService` and `StorageService`
  - [x] Add `force?: boolean` param; short-circuit if pdfUrl exists and !force
  - [x] Build `ContractPdfVm` from repository data; TVA = 19.25%
  - [x] Generate buffer, upload, update DB, return { pdfUrl }

- [x] Task 3 — Update IContractsService + controller (AC: 1)
  - [x] Add `force?: boolean` to `getPdfUrl` signature in interface
  - [x] Add `@Query('force') force?: string` to controller endpoint

- [x] Task 4 — Register PdfService in ContractsModule (AC: 3)
  - [x] Add `PdfService` to ContractsModule providers

- [x] Task 5 — Write unit tests (AC: 1-8)
  - [x] Create `src/contracts/contracts.service.spec.ts`

## Dev Notes

### TVA calculation (Cameroon)
```typescript
const TVA_RATE = 19.25;
const tvaAmount = Math.round(contract.rent * TVA_RATE / 100);
const rentTTC = contract.rent + tvaAmount;
```

### ContractPdfVm fields mapping
- `contractId` → `contract.id`
- `ownerFirstName/LastName` → `contract.property.owner.firstName/lastName`
- `tenantFirstName/LastName` → `contract.tenant.firstName/lastName`
- `tenantIdNumber` → `contract.tenant.nationalIdNumber`
- `propertyTitle/Address/City` → `contract.property.title/address/city`
- `startDate/endDate` → `contract.startDate/endDate`
- `clauses` → `contract.clauses.map(c => c.text)` (ordered by `order ASC`)

### Storage key pattern
```
contracts/{contractId}/contract.pdf
```

### PdfService registration
`PdfService` is in `src/common/services/pdf.service.ts` — not yet globally registered.
Add it as a local provider in `ContractsModule` (scoped; Story 5.5 will add it to PaymentsModule separately).

### Files to UPDATE
- `src/contracts/contract.repository.ts` — add `findByIdForPdf`, `updatePdfUrl`
- `src/contracts/contracts.service.ts` — modify `getPdfUrl`, inject PdfService+StorageService
- `src/contracts/interfaces/contracts-service.interface.ts` — add `force?` to getPdfUrl
- `src/contracts/contracts.controller.ts` — add `@Query('force')` param
- `src/contracts/contracts.module.ts` — add PdfService provider

### Files to CREATE
- `src/contracts/contracts.service.spec.ts` — unit tests for getPdfUrl

### References
- `PdfService`: `src/common/services/pdf.service.ts`
- `ContractPdfVm`: `src/common/services/pdf-view-models.ts`
- `StorageService.uploadBuffer(key, buffer, mimeType)`: returns public URL string
- `StorageModule` is `@Global()` — StorageService injectable without import
- `Contract.pdfUrl String?`: already in schema

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

(none)

### Completion Notes List

- Added `findByIdForPdf(id)` to `ContractRepository` using `select` (not `include`) to fetch property.owner, tenant, clauses — avoids returning extraneous fields.
- Added `updatePdfUrl(id, pdfUrl)` to `ContractRepository` using `prisma.contract.update`.
- `ContractsService.getPdfUrl(id, userId, role, force=false)`: short-circuits with existing URL if `!force`; otherwise calls `findByIdForPdf`, builds `ContractPdfVm` (TVA 19.25% = Math.round(rent × 0.1925)), generates buffer via `PdfService`, uploads to `contracts/{id}/contract.pdf` via `StorageService`, updates DB, returns `{ pdfUrl }`.
- `PdfService` added as local provider in `ContractsModule` (StorageService is already global via `StorageModule @Global()`).
- Controller adds `@Query('force') force?: string` and passes `force === 'true'` to service.
- 5 new unit tests: returns existing URL, generates when null, generates when force=true, VM TVA fields correct, 404 when findByIdForPdf returns null.
- 85 tests pass total (80 pre-existing + 5 new), zero regressions.

### File List

- `src/contracts/contract.repository.ts` — added `findByIdForPdf`, `updatePdfUrl`
- `src/contracts/contracts.service.ts` — replaced stub getPdfUrl with full implementation; inject PdfService + StorageService
- `src/contracts/interfaces/contracts-service.interface.ts` — added `force?` to getPdfUrl
- `src/contracts/contracts.controller.ts` — added `@Query('force')` to getPdf endpoint
- `src/contracts/contracts.module.ts` — added PdfService provider
- `src/contracts/contracts.service.spec.ts` — new file: 5 unit tests
