---
baseline_commit: b55e110e8ce79f066735e5a827ea4505ee6f55e7
---

# Story 11.1: Property image upload wired to Cloudflare R2

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **property owner**,
I want the images I upload for my properties actually stored in Cloudflare R2,
so that they persist across deployments and are accessible via real URLs.

## ⚠️ Pre-Implementation Finding — Read This First

**This feature is already implemented and tested in the current codebase.** Commit `a2339d4` ("feat(properties): enhance property image handling and validation", 2026-07-15) wired real R2 uploads into `PropertiesController.uploadImages()` and `PropertiesService`, after the epic document (`epics-phase3.md`, dated 2026-06-14) was written against an older placeholder-URL implementation. **Do NOT rewrite `uploadImages()`, `addImages()`, or `removeImage()` from scratch** — 3 of 4 ACs are already satisfied with passing tests. Your job on this story is to **verify** the existing implementation against each AC below, close the one confirmed gap (AC2 ordering), and add any assertions the existing test suite doesn't already cover.

## Acceptance Criteria

1. **Given** a valid JPEG image buffer uploaded via `POST /properties/:id/images`, **when** `PropertiesController.uploadImages()` processes the request, **then** `StorageService.uploadBuffer("properties/{propertyId}/images/{imageId}.jpg", buffer, "image/jpeg")` is called and the returned URL is stored on the `PropertyImage` record.
   - **STATUS: ✅ Already satisfied.** `properties.controller.ts:161-181` generates `imageId`/`ext`/`key` and calls `storage.uploadBuffer()` for both the full image and a `sharp`-generated thumbnail. Covered by `properties.controller.spec.ts:113-121`.

2. **Given** a property has 3 images and `DELETE /properties/:id/images/:imageId` is called, **when** the controller processes the deletion, **then** `StorageService.delete(...)` is called **before** the DB record is removed.
   - **STATUS: ⚠️ Gap — order is reversed.** `properties.service.ts:removeImage()` (lines 214-236) currently calls `this.repository.deleteImageById(imageId)` **first**, then `this.storage.delete(...)` for the image and thumbnail. Fix: reorder so both `storage.delete()` calls happen before `deleteImageById()`. Note `StorageService.delete()` (`storage.service.ts:49-57`) already swallows its own errors (`try/catch` + `logger.warn`), so this reorder is about honoring the literal AC / audit trail, not fixing a crash risk.

3. **Given** a property with uploaded images, **when** `GET /properties/:id` is called, **then** all image URLs in the response are real R2 URLs (not placeholder strings like `"placeholder-url"`).
   - **STATUS: ✅ Already satisfied.** `PropertyImage.url`/`thumbUrl` are populated directly from `storage.uploadBuffer()`'s return value (`${publicUrl}/${key}`) — no placeholder path exists for images.
   - **Adjacent, out-of-scope finding:** `properties.controller.ts:239` (`uploadDocuments()`) still hardcodes `` `https://placeholder/${f.originalname}` `` — this is the *documents* sub-resource, not images, and is not covered by any FR-50/51/52 acceptance criterion in Epic 11. Do not fix it under this story; flagged for the user at the end of this file.

4. **Given** the first image is uploaded to a property with no existing images, **when** the upload completes, **then** that image is automatically set as the cover (`isCover: true`).
   - **STATUS: ✅ Already satisfied.** `properties.service.ts:addImages()` (lines 181-202) sets `isCover: !hasCover && idx === 0`. Covered by `properties.service.spec.ts:226-238`.

## Tasks / Subtasks

- [x] Task 1 — Verify AC1, AC3, AC4 against current code (AC: #1, #3, #4)
  - [x] Run `npx jest src/properties/properties.controller.spec.ts src/properties/properties.service.spec.ts` and confirm all pass (34 tests passed, 2 suites)
  - [x] Re-read `properties.controller.ts:141-199` (`uploadImages`) and `properties.service.ts:181-202` (`addImages`) to confirm behavior matches AC1/AC4 — confirmed, no code changes needed
  - [x] Confirm no placeholder URLs exist in the image path (grep `placeholder` in `src/properties/`) — only `properties.controller.ts:239` (documents sub-resource) matched, as expected
- [x] Task 2 — Fix AC2 ordering in `removeImage()` (AC: #2)
  - [x] In `properties.service.ts`, reorder `removeImage()` so `this.storage.delete(...)` (image + thumbnail) executes **before** `this.repository.deleteImageById(imageId)`
  - [x] Preserve existing behavior: 404 on missing image (before any delete), and cover-reassignment to the next image when the deleted image was the cover (`findFirstImage` + `setImageCover`) — unchanged, still passes
- [x] Task 3 — Strengthen test coverage to match AC wording exactly (AC: #1, #2, #3, #4)
  - [x] Added `'deletes both R2 objects BEFORE removing the DB row (AC#2 ordering)'` in `properties.service.spec.ts` under `describe('removeImage', ...)`, asserting `storage.delete` invocation order precedes `repo.deleteImageById` via `mock.invocationCallOrder`
  - [x] Extended `'sets first uploaded image as cover...'` test in `describe('addImages', ...)` to assert `repo.createImages` is called with the exact `url`/`thumbUrl` values passed in (realistic R2 URLs), closing AC3 end-to-end at the service boundary — controller-level closure already existed at `properties.controller.spec.ts:118-120`
  - [x] No new tests added for AC1/AC4 beyond the above — existing coverage confirmed sufficient

## Dev Notes

- **Do not touch `StorageService`** (`src/storage/storage.service.ts`) — its `uploadBuffer(key, buffer, mimeType)`, `delete(key)`, `generateId()`, `generateKey(...parts)`, and `keyFromUrl(url)` methods are stable, already used correctly by `PropertiesController`/`PropertiesService`, and shared with `maintenance.service.ts` (Story 11.2, also already wired — see Previous/Sibling Story Intelligence below).
- **Do not touch `PropertiesController.uploadImages()`'s inline validation** (`ALLOWED_IMAGE_TYPES`, `MAX_IMAGE_SIZE`, `IMAGE_EXT_MAP` at `properties.controller.ts:38-40`) as part of this story — Story 11.3 (`Centralized file upload MIME and size validation`) explicitly supersedes this inline check with a shared `FileValidationPipe` at `src/common/pipes/file-validation.pipe.ts` (confirmed: this file/directory does not exist yet — 11.3 is genuinely unstarted). Changing the inline validation here would create merge friction with 11.3.
- Extension mapping for R2 keys: `image/jpeg → jpg`, `image/png → png`, `image/webp → webp` — already correct in `IMAGE_EXT_MAP`.
- R2 key convention (already followed): `properties/{propertyId}/images/{imageId}.{ext}` and `properties/{propertyId}/images/{imageId}-thumb.{ext}`.
- `PropertiesController.uploadImages()` already has correct ordering for the **upload** path: ownership/quota check (`assertCanAddImages`) happens **before** any R2 write, with `Promise.allSettled` + rollback of any images that succeeded before a sibling failed (`properties.controller.ts:157-193`). This is a good pattern to preserve, not to change.
- Per project-context.md: never bypass `BaseRepository`/`PrismaService` conventions, never `throw new Error(...)` (use NestJS exceptions), FCFA amounts are irrelevant to this story (no money fields touched).

### Project Structure Notes

- No new files needed for this story — all changes are inside `src/properties/properties.service.ts` (and its `.spec.ts`).
- Alignment with `src/common/` conventions confirmed: no guard/decorator/interceptor changes needed here.

### References

- [Source: _bmad-output/planning-artifacts/epics-phase3.md#Story 11.1] — original AC/dev-notes text (written against a stale pre-R2 implementation; superseded by the verification above)
- [Source: src/properties/properties.controller.ts:141-199] — `uploadImages()` current implementation
- [Source: src/properties/properties.service.ts:181-236] — `addImages()`, `removeImage()` current implementation
- [Source: src/storage/storage.service.ts:33-57] — `uploadBuffer()`, `delete()` current implementation
- [Source: src/properties/properties.controller.spec.ts:64-150] — existing `uploadImages()` test coverage
- [Source: src/properties/properties.service.spec.ts:200-280] — existing `addImages()`/`removeImage()` test coverage

## Sibling Story Intelligence (Epic 11)

- **Story 11.2** (Maintenance photo upload → R2): also **already implemented**. `maintenance.service.ts:addPhotos()` (lines 262-307) calls real `storage.uploadBuffer()` with key pattern `maintenance/{requestId}/photos/{photoId}.{ext}` — matches its AC. **However**, unlike properties, it has **zero MIME-type or size validation** on the upload path (`maintenance.controller.ts:72-84`, `maintenance.service.ts:287-288` only checks file count, not type/size). This is exactly the gap Story 11.3's `FileValidationPipe` is meant to close — flag this to whoever picks up 11.2/11.3.
- **Story 11.3** (Centralized `FileValidationPipe`): confirmed **not started** — `src/common/pipes/` does not exist. This is genuinely the epic's remaining real work; once it lands, it should replace `properties.controller.ts`'s inline `ALLOWED_IMAGE_TYPES`/`MAX_IMAGE_SIZE` check and add the missing validation to `maintenance.controller.ts`.

## Git Intelligence Summary

- `a2339d4` (2026-07-15, "feat(properties): enhance property image handling and validation") is the commit that actually implemented this story's core AC surface — 8 files, 630 insertions. It predates this story file's creation, which is why most ACs are already ✅.
- `b55e110` (2026-07-18, "fix(properties): prevent status filter override on public property search") is the most recent commit on this branch — unrelated to image upload, touches `listPublic()` only.
- Current branch: `1-2-validation-email-par-otp`, up to date with `origin`.

## Dev Agent Record

### Agent Model Used

claude-sonnet-5

### Debug Log References

- `npx jest src/properties/properties.controller.spec.ts src/properties/properties.service.spec.ts` — 34 passed (baseline, before Task 2 fix)
- `npx jest src/properties/service.spec.ts -t "AC#2 ordering"` — RED confirmed (1 failed) before the `removeImage()` reorder
- `npx jest src/properties/` — 46 passed (after fix + new tests)
- `npx jest` (full suite) — 312 passed, 26 suites, no regressions
- `npx eslint src/properties/properties.service.ts src/properties/properties.service.spec.ts --fix` — auto-fixed formatting; 12 pre-existing `@typescript-eslint/unbound-method` errors remain, spread across lines unrelated to this story's changes (present before this story, e.g. the file's very first test) — left as-is to avoid scope creep

### Completion Notes List

- Confirmed AC1, AC3, AC4 were already fully implemented and tested (commit `a2339d4`, predates this story). No code changes were needed for these three.
- AC2 had a real gap: `removeImage()` deleted the DB row before deleting the R2 objects, reversed from the AC's specified order. Fixed via red-green-refactor: added a failing ordering test, reordered the two calls in `properties.service.ts`, confirmed green.
- Added explicit test coverage closing the AC3 "real R2 URL" claim at the service boundary (previously only asserted at the controller level).
- `eslint --fix` reformatted the two touched files (prettier line-wrapping) as part of satisfying the lint-clean requirement; no behavior changed by the reformat — full regression suite (312 tests) confirms this.
- Flagged (not fixed, per story scope): `properties.controller.ts:239` (`uploadDocuments()`) still returns placeholder URLs — this is captured as added scope on Story 11.3 in `epics-phase3.md`, not part of this story.

### File List

- `src/properties/properties.service.ts` (modified — `removeImage()` reorder; rest of file reformatted by `eslint --fix`, no logic change)
- `src/properties/properties.service.spec.ts` (modified — added ordering test, extended cover/URL test; rest of file reformatted by `eslint --fix`, no logic change)
- `_bmad-output/implementation-artifacts/11-1-property-image-upload-r2.md` (this story file)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (status transitions: backlog → ready-for-dev → in-progress → review)
- `_bmad-output/planning-artifacts/epics-phase3.md` (Story 11.3 dev notes: added scope note for `uploadDocuments()` R2 wiring, from prior session)

## Change Log

- 2026-07-18: Story created (verification-first framing after discovering AC1/AC3/AC4 already implemented in commit `a2339d4`)
- 2026-07-18: Implemented — fixed AC2 delete-ordering gap in `removeImage()`, added/extended tests for AC2 and AC3, verified no regressions (312/312 tests pass), status → review
