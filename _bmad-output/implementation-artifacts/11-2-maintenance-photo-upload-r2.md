---
baseline_commit: 61c75e1acab26f8c2a5047dcb07f23da9ba16bff
---

# Story 11.2: Maintenance photo upload wired to Cloudflare R2

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **tenant or owner**,
I want maintenance request photos actually stored in Cloudflare R2,
so that maintenance evidence is preserved and accessible to property managers.

## ⚠️ Pre-Implementation Finding — Read This First

**The R2 upload wiring is already implemented.** Commit `d1f1f7f` ("feat(maintenance): implement maintenance request module with CRUD operations and file uploads", 2026-06-13) wired real `StorageService.uploadBuffer()` calls into `MaintenanceService.addPhotos()` — **one day before** the epic doc (`epics-phase3.md`, 2026-06-14) was written, which is why the epic's dev notes describe a "TODO stub" that no longer exists. **Do NOT rewrite `addPhotos()` from scratch.** AC1 is already satisfied. AC2 has one real, narrow gap — read it carefully, it's not what the epic's literal wording suggests.

## Acceptance Criteria

1. **Given** a valid image buffer uploaded via `POST /maintenance/:id/photos`, **when** `MaintenanceController.addPhotos()` processes the request, **then** `StorageService.uploadBuffer("maintenance/{requestId}/photos/{photoId}.{ext}", buffer, mimetype)` is called and the returned URL is stored on the maintenance request's `images` array.
   - **STATUS: ✅ Already satisfied.** `maintenance.service.ts:290-298` generates `photoId` (via `randomUUID()` from Node's `crypto`, **not** `uuidv4()` from the `uuid` package — the epic dev notes are stale on this point, do not "fix" it to match), builds the key, and calls `storage.uploadBuffer()`. Loosely covered by `maintenance.service.spec.ts:303-313`, but that test only asserts `toHaveBeenCalledTimes(1)` — it does not verify the key format or mimetype. See Task 1.

2. **Given** a maintenance request with uploaded photos, **when** its data is read back, **then** all photo URLs in the response are real R2 URLs.
   - **STATUS: ⚠️ Partial gap — one read path silently drops photos.** There is **no `GET /maintenance/:id` route** in `MaintenanceController` — the epic's literal wording doesn't match the actual API surface. Do not add one; it's not needed. Two real read paths exist instead:
     - `POST /maintenance/search` (OWNER/MANAGER/ADMIN) → `MaintenanceService.search()` → `BaseService.findWithPagination()` → `BaseRepository.findWithPagination()` (`base.repository.ts:70-90`), which calls Prisma `findMany` with **no `select` clause** — this returns every scalar column including `images`, so real R2 URLs already flow through here correctly. **No change needed for this path.**
     - `GET /maintenance/my-requests` (TENANT) → `MaintenanceService.getMyRequests()` (`maintenance.service.ts:238-258`) → explicit Prisma `select` that **omits `images` entirely**. A tenant — one of this story's two named actors, and the only role that can both create a request and is restricted to viewing just their own — uploads photos via `POST /maintenance/:id/photos` and then **cannot see them** through their own dashboard endpoint. This is the one required code change in this story.

## Tasks / Subtasks

- [x] Task 1 — Strengthen AC1 test coverage (AC: #1)
  - [x] In `maintenance.service.spec.ts`, extend the existing `'OWNER can upload photos and they are appended'` test (or add a new one in the same `describe('addPhotos', ...)` block) to assert `storage.uploadBuffer` was called with the exact key `maintenance/maint-1/photos/<generated-id>.jpg` and mimetype `image/jpeg` — not just call count. Use the existing `FILE` fixture (`originalname: 'photo.jpg'`, `mimetype: 'image/jpeg'`).
  - [x] No source changes expected for this task — verification + test only.
- [x] Task 2 — Fix AC2 gap: TENANT can't see their own uploaded photos (AC: #2)
  - [x] In `maintenance.service.ts`, add `images: true` to the `select` block inside `getMyRequests()` (`maintenance.service.ts:244-253`)
  - [x] In `maintenance.service.spec.ts`, add a test under a `describe('getMyRequests', ...)` block (create if it doesn't exist) asserting the returned data includes the `images` field with the R2 URLs from the mocked Prisma response
- [x] Task 3 — Close a real gap in existing `addPhotos` authorization test coverage (AC: #1, #2 — indirectly, ensures only authorized actors reach the storage/DB write)
  - [x] Add a test: OWNER who does **not** own the property (`existing.property.ownerId !== user.id`) → `ForbiddenException('NOT_PROPERTY_OWNER')`, mirroring the existing `'TENANT who is NOT the creator throws 403'` test but for the OWNER branch (`maintenance.service.ts:283-285`)
- [x] Task 4 — Create `maintenance.controller.spec.ts` (AC: #1)
  - [x] This file does not exist yet — `MaintenanceController` currently has zero test coverage. Model it directly on `properties.controller.spec.ts`'s `describe('PropertiesController — uploadImages()', ...)` block (`properties.controller.spec.ts:64-152`): `Test.createTestingModule` with `controllers: [MaintenanceController]`, `providers: [{ provide: MaintenanceService, useValue: <mocked service> }]`. No guard override is needed (unlike `PropertiesController`, `MaintenanceController` has no `@UseGuards(MandateGuard)` — confirmed by reading the controller; `RolesGuard` is a global `APP_GUARD` and does not run when calling controller methods directly in a unit test).
  - [x] Minimum coverage: `addPhotos()` delegates to `service.addPhotos(user, id, files)` with the right arguments and returns its result. Keep it scoped to this story — do not add coverage for `create`/`updateStatus`/`search`/`getMyRequests` in this file; that's a separate concern.

## Dev Notes

- **Do not touch `StorageService`** (`src/storage/storage.service.ts`) — stable, already used correctly here and by `PropertiesService` (Story 11.1, also already wired).
- **Do not add MIME-type or file-size validation** in this story. `addPhotos()` currently validates only file **count** (`files.length > 3` → `BadRequestException('TOO_MANY_FILES')`, `maintenance.service.ts:288`) — there is genuinely **zero** MIME/size check today, unlike `PropertiesController.uploadImages()` which has inline validation. This is intentional: Story 11.3 (`Centralized file upload MIME and size validation`, confirmed **not started** — `src/common/pipes/` does not exist) will add a shared `FileValidationPipe` to this endpoint. Adding ad-hoc validation here would create merge friction with 11.3.
- **Do not add a `GET /maintenance/:id` route.** See AC2 status above — the epic's wording doesn't match the real API surface, and the fix needed is in `getMyRequests()`'s `select`, not a new endpoint.
- The Multer `FilesInterceptor('photos[]', 3)` decorator (`maintenance.controller.ts:77`) already truncates/rejects beyond 3 files at the interceptor level in the real HTTP path — the service's own `files.length > 3` check (`maintenance.service.ts:288`) is defense-in-depth for direct service calls (e.g., tests). Both are correct as-is; don't remove either.
- Extension mapping for R2 keys: `file.originalname.match(/\.(\w+)$/)`, defaulting to `'jpg'` if no extension is found — already correct, matches the pattern used in `PropertiesService`.
- R2 key convention (already followed): `maintenance/{requestId}/photos/{photoId}.{ext}`.
- Per project-context.md: never bypass `BaseRepository`/`PrismaService` conventions, never `throw new Error(...)` (use NestJS exceptions — this file already does), FCFA amounts are irrelevant to this story.

### Project Structure Notes

- All source changes are inside `src/maintenance/maintenance.service.ts` (Task 2 only — one `select` line).
- One new test file: `src/maintenance/maintenance.controller.spec.ts` (Task 4) — does not exist today, follows the existing `src/properties/properties.controller.spec.ts` convention (co-located `.spec.ts`, `Test.createTestingModule` from `@nestjs/testing`).
- No new modules, guards, or decorators needed.

### References

- [Source: _bmad-output/planning-artifacts/epics-phase3.md#Story 11.2] — original AC/dev-notes text (written one day after the R2 wiring commit landed; stale on the "TODO stub" and "GET /maintenance/:id" points, superseded by the verification above)
- [Source: src/maintenance/maintenance.controller.ts:70-84] — `addPhotos()` route, current implementation (no `GET :id` route exists)
- [Source: src/maintenance/maintenance.service.ts:238-307] — `getMyRequests()`, `addPhotos()` current implementation
- [Source: src/common/abstractions/base.repository.ts:70-90] — `findWithPagination()`, confirms no `select` clause (used by `search()`, so images already pass through for OWNER/MANAGER/ADMIN)
- [Source: src/maintenance/maintenance.service.spec.ts:294-344] — existing `addPhotos()` test coverage
- [Source: src/properties/properties.controller.spec.ts:64-152] — pattern to model the new `maintenance.controller.spec.ts` on

## Sibling Story Intelligence (Epic 11)

- **Story 11.1** (Property image upload → R2): already implemented and verified; AC2 delete-ordering fixed, currently in `review` status. Same `StorageService` is shared — no conflicts expected.
- **Story 11.3** (Centralized `FileValidationPipe`): confirmed **not started**. Its scope was expanded on 2026-07-18 (during 11.1's review) to also wire `PropertiesController.uploadDocuments()` to real R2 storage. Once it lands, it will add MIME/size validation to this story's `POST /:id/photos` endpoint too — do not preempt that here.

## Git Intelligence Summary

- `d1f1f7f` (2026-06-13, "feat(maintenance): implement maintenance request module with CRUD operations and file uploads") is the commit that implemented this story's core AC1 surface, one day before the epic doc was written — explains why the epic's dev notes are stale (TODO stub claim, `GET /maintenance/:id` route assumption).
- No maintenance-module commits since `d1f1f7f` — `search()` and `getMyRequests()` have not been touched since initial implementation, confirming the `images`-omission gap in `getMyRequests()` has been present since day one, not a recent regression.
- `a2339d4` / `b55e110` (Story 11.1 work, 2026-07-15/18) — properties-only, no overlap with this story's files.
- Current branch: `1-2-validation-email-par-otp`, up to date with `origin`.

## Dev Agent Record

### Agent Model Used

claude-sonnet-5

### Debug Log References

### Completion Notes List

- AC1 (upload wiring) confirmed already correct; strengthened `addPhotos()` test to assert exact R2 key pattern and mimetype instead of just call count.
- AC2 gap fixed: `getMyRequests()`'s Prisma `select` was missing `images`, so a TENANT who uploaded photos via `POST /:id/photos` could never see them through their own `GET /maintenance/my-requests` view. Added `images: true` to the select (one-line change) + a test proving the R2 URLs now flow through.
- Closed a real, pre-existing authorization test gap: `addPhotos()` already correctly rejects an OWNER who doesn't own the property, but no test covered it (only the TENANT-not-creator branch was tested). Added it.
- Created `maintenance.controller.spec.ts` (didn't exist before) covering `addPhotos()`'s delegation to the service, modeled on `properties.controller.spec.ts`'s `uploadImages()` block.
- Ran `eslint --fix` on all touched files to match repo prettier conventions (same as Story 11.1's precedent) — reformatting only, no behavior change. Two `no-unsafe-assignment`/`no-unsafe-argument` findings remain in the new controller spec from `MOCK_USER as any` casts — this mirrors the identical, already-accepted pattern in `properties.controller.spec.ts`, not a new regression.
- Full suite: 316/316 tests pass (27 suites), no regressions.
- Confirmed AC2's literal "GET /maintenance/:id" wording doesn't match the real API (no such route exists) — did not add one; the fix landed in the correct existing read path per the story's Dev Notes.

### File List

- `src/maintenance/maintenance.service.ts` (modified — `getMyRequests()` select now includes `images`)
- `src/maintenance/maintenance.service.spec.ts` (modified — 3 new tests: R2 key/mimetype assertion, `getMyRequests` images coverage, OWNER-not-property-owner 403)
- `src/maintenance/maintenance.controller.spec.ts` (new — first test coverage for `MaintenanceController`)

## Change Log

- 2026-07-23: Story implemented — AC2 gap fixed in `getMyRequests()`, test coverage strengthened for AC1/AC2/authorization, new controller spec added. 316/316 tests passing.
