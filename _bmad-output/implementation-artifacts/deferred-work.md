# Deferred Work

## Deferred from: code review of 11-2-maintenance-photo-upload-r2 (2026-07-23)

- Heavy `as any`/`as never` casts in `src/maintenance/maintenance.controller.spec.ts` and `src/maintenance/maintenance.service.spec.ts` — pre-existing project-wide test convention, already tracked under Story 16-4 (eliminate-unsafe-typescript-casts). Not fixed here to avoid scope creep beyond this story.
