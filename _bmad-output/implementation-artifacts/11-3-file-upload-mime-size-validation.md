---
baseline_commit: 35a53127f393fc7b7c2c3218ffd003eba1b23bf1
---

# Story 11.3: Centralized file upload MIME and size validation

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **system**,
I want all file upload endpoints to reject invalid files before any storage call,
so that Cloudflare R2 is never polluted with wrong file types or oversized uploads.

## ⚠️ Pre-Implementation Findings — Read This First

Two things the epic doc got wrong, discovered by actually reading the current code:

1. **HTTP 413/415 will never happen in this codebase — use 400 instead.** The epic's ACs say the pipe should return `HTTP 415 Unsupported Media Type` / `HTTP 413 Content Too Large`. But `GlobalExceptionFilter` (`src/common/filters/http-exception.filter.ts:26-29`) already **deliberately remaps** any `PayloadTooLargeException` down to `HTTP 400` with `error: 'FILE_TOO_LARGE'` — there's an explicit comment there explaining this is intentional, to match the manual size checks used everywhere else. And all three existing inline validations (`properties.controller.ts:153-154`, `users.controller.ts:67-68`, the pattern `maintenance.controller.ts` lacks entirely) already throw `BadRequestException('INVALID_FILE_TYPE')` / `BadRequestException('FILE_TOO_LARGE')` — **400, not 415/413**. `FileValidationPipe` must throw `BadRequestException` with those same string codes, not raw `UnsupportedMediaTypeException`/`PayloadTooLargeException`, or you'll create two different error shapes for the identical failure across sibling endpoints.
2. **The epic's audit source ("all controllers with FileInterceptor") undersold the actual surface.** A full grep for `FileInterceptor`/`FilesInterceptor` across `src/` turns up 4 controllers, not 2: `properties.controller.ts` (images + documents), `maintenance.controller.ts` (photos), **`users.controller.ts`** (avatar — not previously documented anywhere), and **`messages.controller.ts`** (attachment — not previously documented anywhere, and it's a complete stub). See Task 5 for why the last two are explicitly **out of scope** for this story.

## Acceptance Criteria

1. **Given** a file with MIME type `"text/plain"` uploaded to `POST /properties/:id/images`, **when** `FileValidationPipe` runs, **then** `BadRequestException('INVALID_FILE_TYPE')` (HTTP 400) is returned before `StorageService` is called.
   - Corrected from the epic's literal "HTTP 415" — see Finding 1 above.
2. **Given** a valid JPEG file of 6 MB uploaded to `POST /properties/:id/images` or `POST /maintenance/:id/photos`, **when** `FileValidationPipe` runs, **then** `BadRequestException('FILE_TOO_LARGE')` (HTTP 400) is returned before `StorageService` is called.
   - Corrected from the epic's literal "HTTP 413" — see Finding 1 above.
3. **Given** an `application/msword` file uploaded to `POST /properties/:id/documents`, **when** `FileValidationPipe` runs, **then** `BadRequestException('INVALID_FILE_TYPE')` (HTTP 400) is returned.
4. **Given** a valid PDF file of 12 MB uploaded to `POST /properties/:id/documents`, **when** `FileValidationPipe` runs, **then** `BadRequestException('FILE_TOO_LARGE')` (HTTP 400) is returned (max 10 MB for documents).
5. **Given** a valid JPEG file of 3 MB uploaded to `POST /properties/:id/images`, **when** `FileValidationPipe` runs, **then** validation passes and the file proceeds to the controller/service as it does today.
6. **Given** `POST /properties/:id/documents` is called with valid files, **when** the controller processes them, **then** `StorageService.uploadBuffer("properties/{propertyId}/documents/{documentId}.{ext}", buffer, mimetype)` is called and the returned real R2 URL is stored — **not** the current hardcoded `` `https://placeholder/${f.originalname}` `` (`properties.controller.ts:239`).

## Tasks / Subtasks

- [x] Task 1 — Create `FileValidationPipe` (AC: #1, #2, #3, #4, #5)
  - [x] Create `src/common/pipes/file-validation.pipe.ts` implementing `PipeTransform<Express.Multer.File | Express.Multer.File[]>`
  - [x] Constructor params: `allowedMimeTypes: string[]`, `maxSizeBytes: number`
  - [x] `transform()` must accept **both** a single file (from `@UploadedFile()`) and an array (from `@UploadedFiles()`) — check `Array.isArray(value)` and validate each entry the same way
  - [x] On MIME mismatch: `throw new BadRequestException('INVALID_FILE_TYPE')`. On size exceeded (`file.buffer.length > maxSizeBytes`, matching the existing inline checks' convention): `throw new BadRequestException('FILE_TOO_LARGE')`. No other exception types — see Pre-Implementation Finding 1.
  - [x] If `value` is `undefined`/empty (no files provided), pass through without throwing — some endpoints treat "no files" as a separate, endpoint-specific error (e.g., maintenance's `NO_FILES`), which is not this pipe's job
  - [x] Presets are constructed inline at each call site (`new FileValidationPipe([...], ...)`), matching the epic's own dev-notes example usage — no separate exported constant needed since each controller already re-declares its own type/size constants
- [x] Task 2 — Unit tests for `FileValidationPipe` (AC: #1, #2, #3, #4, #5)
  - [x] Create `src/common/pipes/file-validation.pipe.spec.ts`
  - [x] Cover: single file valid, single file wrong type, single file too large, array with one bad file among good ones (whole array should reject), empty/undefined input passes through, both presets' exact thresholds (image 5 MB boundary, document 10 MB boundary — test at the boundary and one byte over) — 13 tests, all passing
- [x] Task 3 — Apply the pipe to `PropertiesController.uploadImages()` and remove the now-duplicated inline check (AC: #1, #2, #5)
  - [x] In `properties.controller.ts`, changed `@UploadedFiles() files: Express.Multer.File[]` to `@UploadedFiles(new FileValidationPipe(ALLOWED_IMAGE_TYPES, MAX_IMAGE_SIZE)) files: Express.Multer.File[]`, reusing the existing module-level constants
  - [x] Deleted the inline validation loop (`if (!ALLOWED_IMAGE_TYPES.includes(...))` / `if (file.buffer.length > MAX_IMAGE_SIZE)`) — this logic now lives in the pipe
  - [x] Kept `IMAGE_EXT_MAP` — unrelated to this change
  - [x] **Breaking-test warning resolved:** deleted the two direct-call tests from `properties.controller.spec.ts` (they could never have exercised a parameter pipe); equivalent coverage lives in `file-validation.pipe.spec.ts`. 7/7 tests pass in this file.
- [x] Task 4 — Apply the document preset to `PropertiesController.uploadDocuments()` AND wire it to real R2 storage (AC: #3, #4, #6)
  - [x] Added `new FileValidationPipe(ALLOWED_DOCUMENT_TYPES, MAX_DOCUMENT_SIZE)` to the `@UploadedFiles()` parameter (new module-level constants, same pattern as the image ones)
  - [x] Replaced the hardcoded placeholder URL with a real `this.storage.uploadBuffer(key, file.buffer, file.mimetype)` call, key pattern `properties/{propertyId}/documents/{documentId}.pdf` (extension hardcoded since only `application/pdf` is allowed). Method is now `async`.
  - [x] Added 2 tests in `properties.controller.spec.ts`: correct key/URL wiring, and `body.names` override vs `originalname` fallback. 9/9 tests pass in this file.
- [x] Task 5 — Apply the image preset to `MaintenanceController.addPhotos()` (AC: #1, #2, #5)
  - [x] Added `new FileValidationPipe(ALLOWED_PHOTO_TYPES, MAX_PHOTO_SIZE)` to the `@UploadedFiles()` parameter (new module-level constants)
  - [x] Closed the real gap: `MaintenanceService.addPhotos()` had zero MIME/size validation before this
  - [x] Added an explanatory comment in `maintenance.controller.spec.ts` (no fake test) noting pipe behavior is covered by `file-validation.pipe.spec.ts`, per the Task 3 lesson — direct controller-method calls can't exercise a parameter pipe
  - [x] Did **not** touch `UsersController.uploadAvatar()` or `MessagesController.uploadAttachment()`

## Dev Notes

- **Why `UsersController.uploadAvatar()` is out of scope:** it already has its own inline MIME/size check (`users.controller.ts:66-68`) at a **2 MB** limit — different from this story's 5 MB image preset. Swapping it to the shared pipe would silently change the avatar size limit, which is a product decision, not a refactor. If you want to unify it, that's a separate story/decision, not this one.
- **Why `MessagesController.uploadAttachment()` is out of scope:** it's a complete stub (`messages.controller.ts:57-64`) — no `StorageService` injected, no validation, hardcoded `{ url: 'https://placeholder/attachment' }` return. Wiring it needs its own scoping (what file types should attachments allow? what size limit?) — tracked as new backlog item `11-4-messages-attachment-upload-r2`. Don't fold it into this story.
- **Multer's own `limits.fileSize` is a separate, pre-existing mechanism — don't remove it.** `properties.controller.ts:146` (`FilesInterceptor('images[]', 20, { limits: { fileSize: MAX_IMAGE_SIZE } })`) and `users.controller.ts:62` already cap size at the Multer/interceptor level, before Express even finishes buffering the upload — a request exceeding that throws `PayloadTooLargeException`, which `GlobalExceptionFilter` remaps to 400/`FILE_TOO_LARGE` (see Finding 1). `maintenance.controller.ts:77` and `messages.controller.ts:60` have **no** such Multer-level limit today, so `FileValidationPipe` is the *only* size gate for those two — this is fine and expected, not a bug to fix.
- **Do not touch `StorageService`** (`src/storage/storage.service.ts`) — stable, shared across properties/maintenance, used correctly by both.
- Per project-context.md: never bypass `BaseRepository`/`PrismaService` conventions, never `throw new Error(...)` (use NestJS exceptions — this story is entirely about exceptions, so this matters more than usual here).

### Project Structure Notes

- New file: `src/common/pipes/file-validation.pipe.ts` (the directory `src/common/pipes/` does not exist yet — create it)
- New file: `src/common/pipes/file-validation.pipe.spec.ts`
- Modified: `src/properties/properties.controller.ts`, `src/properties/properties.controller.spec.ts` (2 tests removed, new tests added for `uploadDocuments()`)
- Modified: `src/maintenance/maintenance.controller.ts`, `src/maintenance/maintenance.controller.spec.ts`
- No changes to `src/users/` or `src/messages/` in this story.

### References

- [Source: _bmad-output/planning-artifacts/epics-phase3.md#Story 11.3] — original AC/dev-notes text (415/413 status codes are stale — see Finding 1; "all controllers with FileInterceptor" audit source was incomplete — see Finding 2)
- [Source: src/common/filters/http-exception.filter.ts:23-29] — `GlobalExceptionFilter`'s deliberate 413→400 remap, the reason this story uses 400 everywhere
- [Source: src/properties/properties.controller.ts:38-40, 141-199, 226-242] — `uploadImages()`/`uploadDocuments()` current implementation, inline validation to remove, placeholder URL to replace
- [Source: src/maintenance/maintenance.controller.ts:70-84] — `addPhotos()` current implementation, zero validation today
- [Source: src/users/users.controller.ts:51-86] — `uploadAvatar()`, out of scope, why
- [Source: src/messages/messages.controller.ts:57-64] — `uploadAttachment()`, out of scope, why
- [Source: src/properties/properties.controller.spec.ts:64-152] — existing `uploadImages()` tests, 2 of which must be deleted (Task 3)
- [Source: src/storage/storage.service.ts:33-77] — `uploadBuffer()`, `generateId()`, `generateKey()` signatures to reuse in Task 4

## Sibling Story Intelligence (Epic 11)

- **Story 11.1** (Property image upload → R2): done, in `review`. Its inline validation (`ALLOWED_IMAGE_TYPES`/`MAX_IMAGE_SIZE`/`IMAGE_EXT_MAP`) is exactly what Task 3 replaces.
- **Story 11.2** (Maintenance photo upload → R2): `done`. Confirmed `addPhotos()` has zero MIME/size validation — exactly what Task 5 closes.
- **New: Story 11-4** (`messages-attachment-upload-r2`, `backlog`): created as a result of this story's own audit (Finding 2). Needs product input on allowed attachment types/size before it can be scoped — not a copy-paste of this story's presets.

## Git Intelligence Summary

- `d1f1f7f` (2026-06-13) implemented the maintenance module with zero file validation from day one.
- `a2339d4` (2026-07-15) added properties' inline image validation (`ALLOWED_IMAGE_TYPES` etc.) — this is the logic Task 3 centralizes.
- `61c75e1` (2026-07-18) and `35a5312` (2026-07-23) are Stories 11.1/11.2's review-round fixes — no overlap with this story's files except `properties.controller.spec.ts` and `maintenance.controller.spec.ts`, which this story also touches; no conflict expected since different describe blocks.
- No prior commit touches `users.controller.ts` or `messages.controller.ts` in the file-upload context beyond their original implementation — confirms Finding 2 is a genuinely new discovery, not something a previous story already scoped and dropped.
- Current branch: `1-2-validation-email-par-otp`.

## Dev Agent Record

### Agent Model Used

claude-sonnet-5

### Debug Log References

### Completion Notes List

- Corrected the epic's stated HTTP 413/415 status codes to 400 (`BadRequestException` with `INVALID_FILE_TYPE`/`FILE_TOO_LARGE`), matching `GlobalExceptionFilter`'s deliberate remap and every existing inline check in the codebase — see Pre-Implementation Finding 1.
- `FileValidationPipe` (`src/common/pipes/file-validation.pipe.ts`) accepts both a single file and an array, uses `file.buffer.length` for size (matching the established convention, not `.size`), and passes through `undefined`/empty input untouched. 13 unit tests.
- Applied the pipe to `PropertiesController.uploadImages()`, removing the now-duplicated inline validation loop. Deleted the 2 existing controller tests that could never have exercised a real parameter pipe (direct method calls bypass NestJS's pipe pipeline) — equivalent coverage now lives in the pipe's own spec.
- Applied the document preset to `PropertiesController.uploadDocuments()` **and** wired it to real R2 storage (was a hardcoded placeholder URL before this story) — method is now `async`. Added 2 new controller tests.
- Applied the image preset to `MaintenanceController.addPhotos()`, closing a real gap (zero MIME/size validation existed before). Added an explanatory comment (no fake test) in its spec file, same reasoning as the properties case.
- Confirmed and left untouched, per Dev Notes: `UsersController.uploadAvatar()` (own inline check, different size limit — changing it is a product decision) and `MessagesController.uploadAttachment()` (complete stub — needs its own scoping, tracked as new backlog item `11-4-messages-attachment-upload-r2`).
- Full suite: 333/333 tests pass (28 suites), no regressions. Ran `eslint --fix` on all touched files (prettier reformatting only). Remaining lint findings (`no-unsafe-*` in test files, one unrelated `_id` unused-var in `getApplications()`) are pre-existing — either already tracked under Story 16-4 or entirely outside this story's diff — left as-is per established precedent from Stories 11.1/11.2.

### File List

- `src/common/pipes/file-validation.pipe.ts` (new)
- `src/common/pipes/file-validation.pipe.spec.ts` (new)
- `src/properties/properties.controller.ts` (modified — pipe applied to `uploadImages()` and `uploadDocuments()`; `uploadDocuments()` now wired to real R2 storage)
- `src/properties/properties.controller.spec.ts` (modified — 2 obsolete tests removed, 2 new tests added for `uploadDocuments()`)
- `src/maintenance/maintenance.controller.ts` (modified — pipe applied to `addPhotos()`)
- `src/maintenance/maintenance.controller.spec.ts` (modified — explanatory comment added, no behavior change)
- `_bmad-output/planning-artifacts/epics-phase3.md` (modified — documented the users-avatar/messages-attachment discovery)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified — added `11-4-messages-attachment-upload-r2` backlog item)

## Change Log

- 2026-07-24: Story implemented — `FileValidationPipe` created and applied to properties images/documents and maintenance photos; `uploadDocuments()` wired to real R2 storage; 2 obsolete controller tests removed, 16 new tests added (13 pipe + 3 controller). 333/333 tests passing. Discovered and scoped out `UsersController.uploadAvatar()` and `MessagesController.uploadAttachment()`; the latter tracked as new Story 11-4.
