---
baseline_commit: 575809f0348d090b16021b5edc06a6cbceee234f
---

# Story 0.2: EventEmitter2 Global + DomainEvent Base Class

Status: review

## Story

As a **developer**,
I want EventEmitter2 configured globally in AppModule and a DomainEvent base class available in `src/common/events/`,
So that any module can emit and subscribe to domain events using NestJS `@OnEvent()` without circular dependencies or manual wiring.

## Acceptance Criteria

1. `@nestjs/event-emitter` is installed and `EventEmitterModule.forRoot()` is imported in `AppModule` with the canonical configuration (`wildcard: true`, `delimiter: '.'`, `maxListeners: 20`, `verboseMemoryLeak: true`).
2. Any injectable service can inject `EventEmitter2` from `@nestjs/event-emitter` and call `this.eventEmitter.emit('some.event', payload)` without additional module imports.
3. Any injectable service decorated with `@OnEvent('some.event')` receives the payload when the event is emitted.
4. A `DomainEvent` abstract base class exists at `src/common/events/domain-event.base.ts` with readonly fields `occurredAt: Date` and `eventId: string` (UUID v4), and an abstract `eventName: string`.
5. The `src/common/events/` directory is exported from a barrel `index.ts` so importing from `'../common/events'` works.
6. A concrete example event (`TestDomainEvent`) is created and used in a unit test to validate the base class behaves correctly.
7. All existing tests continue to pass (no regressions in AppModule bootstrap).

## Tasks / Subtasks

- [x] Task 1 — Install `@nestjs/event-emitter` package (AC: 1)
  - [x] Run `npm install @nestjs/event-emitter` in project root
  - [x] Verify `package.json` and `package-lock.json` updated

- [x] Task 2 — Configure EventEmitterModule in AppModule (AC: 1, 2, 3)
  - [x] Import `EventEmitterModule` from `@nestjs/event-emitter` in `src/app.module.ts`
  - [x] Add `EventEmitterModule.forRoot({ wildcard: true, delimiter: '.', maxListeners: 20, verboseMemoryLeak: true })` to `AppModule.imports[]`
  - [x] Verify AppModule compiles without errors (`npm run build` or `tsc --noEmit`)

- [x] Task 3 — Create DomainEvent base class (AC: 4, 5)
  - [x] Create directory `src/common/events/` if it does not exist
  - [x] Create `src/common/events/domain-event.base.ts` with abstract class `DomainEvent`
  - [x] Create `src/common/events/index.ts` barrel exporting `DomainEvent`

- [x] Task 4 — Write unit tests (AC: 4, 6, 7)
  - [x] Create `src/common/events/domain-event.base.spec.ts`
  - [x] Test: concrete subclass sets `occurredAt` to a Date near `new Date()`
  - [x] Test: `eventId` is a valid UUID v4 string
  - [x] Test: two instances of the same event class have different `eventId` values
  - [x] Run `npm test` — all tests pass

- [x] Task 5 — Integration smoke test (AC: 2, 3)
  - [x] Create `src/common/events/event-emitter.spec.ts` (integration test using `Test.createTestingModule`)
  - [x] Test: a service that emits `'test.happened'` causes a handler decorated with `@OnEvent('test.happened')` to be called
  - [x] Wildcard test: emitting `'payment.registered'` triggers `@OnEvent('payment.*')` handler
  - [x] Run full test suite — no regressions

## Dev Notes

### Critical Implementation Details

**Package to install** (NOT in package.json yet):
```bash
npm install @nestjs/event-emitter
# This installs: @nestjs/event-emitter + eventemitter2 (peer dep)
```

**AppModule change — add to imports array** (`src/app.module.ts`):
```typescript
import { EventEmitterModule } from '@nestjs/event-emitter';

// In @Module({ imports: [...] }):
EventEmitterModule.forRoot({
  wildcard: true,
  delimiter: '.',
  maxListeners: 20,
  verboseMemoryLeak: true,
}),
```
Place it AFTER `ConfigModule` and BEFORE feature modules to ensure it's available everywhere.

**DomainEvent base class** (`src/common/events/domain-event.base.ts`):
```typescript
import { v4 as uuidv4 } from 'uuid';

export abstract class DomainEvent {
  readonly occurredAt: Date = new Date();
  readonly eventId: string = uuidv4();
  abstract readonly eventName: string;
}
```

**Barrel export** (`src/common/events/index.ts`):
```typescript
export * from './domain-event.base';
```

**How to emit (in any service)**:
```typescript
import { EventEmitter2 } from '@nestjs/event-emitter';

constructor(private readonly eventEmitter: EventEmitter2) {}

// Emit:
this.eventEmitter.emit('payment.registered', new PaymentRegisteredEvent({ ... }));
```

**How to subscribe (in any handler)**:
```typescript
import { OnEvent } from '@nestjs/event-emitter';

@OnEvent('payment.registered')
async handlePaymentRegistered(event: PaymentRegisteredEvent) { ... }

// Wildcard:
@OnEvent('payment.*')
async handleAnyPayment(event: DomainEvent) { ... }
```

### RULE — No chained events
Event handlers MUST NOT emit further events. This is a project-wide convention to prevent circular chains and unpredictable execution order.

### TypeScript module resolution
Project uses `"module": "nodenext"` and `"moduleResolution": "nodenext"`. Imports from `@nestjs/event-emitter` work directly. Internal imports from `./domain-event.base` do NOT need `.js` extension when inside spec files (Jest transforms them), but DO need `.js` extension in production `.ts` files compiled with `tsc`.

Check `tsconfig.json` — if `"moduleResolution": "nodenext"` is set, production imports should use:
```typescript
import { DomainEvent } from './domain-event.base.js';
```
For barrel imports in other modules:
```typescript
import { DomainEvent } from '../common/events/index.js';
```

### Project Structure Notes

**Files to CREATE:**
- `src/common/events/domain-event.base.ts`
- `src/common/events/index.ts`
- `src/common/events/domain-event.base.spec.ts`
- `src/common/events/event-emitter.spec.ts`

**Files to MODIFY:**
- `src/app.module.ts` — add `EventEmitterModule.forRoot(...)` to imports
- `package.json` / `package-lock.json` — `npm install @nestjs/event-emitter`

**Files to NOT touch:**
- `src/prisma/prisma.service.ts` — no changes needed
- Any existing service or module — this story only wires infrastructure

### Existing patterns to preserve
- `AppModule` providers order: `APP_FILTER` → `APP_GUARD` (JwtAuthGuard, RolesGuard, ThrottlerGuard) → `APP_INTERCEPTOR` (LoggingInterceptor, TransformInterceptor). Do NOT reorder.
- `ConfigModule.forRoot({ isGlobal: true })` must remain FIRST in imports.

### References

- Architecture §6 — Domain Events: `_bmad-output/planning-artifacts/architecture.md#6-domain-events`
- Project Context §8 — EventBus Pattern: `_bmad-output/project-context.md#8-domain-events`
- AppModule current state: `src/app.module.ts`
- UUID import pattern: `import { v4 as uuidv4 } from 'uuid'` (uuid v14 installed)

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

- uuid v14 is ESM-only; Jest's default `transformIgnorePatterns` excluded it, causing `SyntaxError: Unexpected token 'export'`. Fixed by adding `"transformIgnorePatterns": ["/node_modules/(?!(uuid)/)"]` to the Jest config in `package.json`. This also unmasked a pre-existing latent bug in `properties.service.spec.ts` (hardcoded regular space vs. narrow no-break space from `toLocaleString('fr-FR')`), which was fixed in the same pass.

### Completion Notes List

- Installed `@nestjs/event-emitter@^3.1.0` (added to `dependencies` in `package.json`).
- Added `EventEmitterModule.forRoot({ wildcard: true, delimiter: '.', maxListeners: 20, verboseMemoryLeak: true })` to `AppModule.imports[]` after `ThrottlerModule` and before infrastructure modules, per AC 1.
- Created `src/common/events/domain-event.base.ts` — abstract `DomainEvent` base class with `occurredAt: Date`, `eventId: string` (UUID v4), and abstract `eventName: string`, per AC 4.
- Created `src/common/events/index.ts` barrel re-exporting `DomainEvent`, per AC 5.
- Unit tests (4 cases) in `domain-event.base.spec.ts` verify: occurredAt is Date near now, eventId is UUID v4, two instances get unique eventIds, eventName is correctly inherited, per AC 6.
- Integration smoke tests (3 cases) in `event-emitter.spec.ts` using `Test.createTestingModule` verify: exact `@OnEvent` listener fires, wildcard `@OnEvent('payment.*')` listener fires, both fire on same emit, per AC 2, 3.
- Added `transformIgnorePatterns` to Jest config to handle uuid v14 ESM. Also fixed a latent test bug in `properties.service.spec.ts` (priceLabel used hardcoded space instead of `toLocaleString` result).
- All 21 tests pass (7 new + 14 pre-existing), zero regressions.

### File List

- `package.json` — added `@nestjs/event-emitter` dependency + `transformIgnorePatterns` Jest config
- `package-lock.json` — updated by npm install
- `src/app.module.ts` — added `EventEmitterModule` import and `forRoot` in imports array
- `src/common/events/domain-event.base.ts` — new file: abstract DomainEvent base class
- `src/common/events/index.ts` — new file: barrel export
- `src/common/events/domain-event.base.spec.ts` — new file: 4 unit tests
- `src/common/events/event-emitter.spec.ts` — new file: 3 integration smoke tests
- `src/properties/properties.service.spec.ts` — fixed latent priceLabel assertion bug (narrow no-break space)
