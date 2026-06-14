---
baseline_commit: 0a1607a716309289e4a6f585c560a9037556c630
---

# Story 10.4: Turnstile Anti-Bot Protection on Public Forms

Status: review

## Story

As a **platform operator**,
I want all public-facing application submission endpoints to require a Cloudflare Turnstile token,
So that automated bots cannot flood the system with fake rental applications.

## Acceptance Criteria

1. `POST /applications` (anonymous) requires a valid `turnstileToken` in the request body; missing or invalid token returns HTTP 422.
2. `POST /properties/:slug/applications` (anonymous) requires a valid `turnstileToken` in the request body; missing or invalid token returns HTTP 422.
3. Both endpoints are rate-limited to **5 requests per hour per IP** (overriding the global 200/60 s limit).
4. A valid `turnstileToken` is verified against `https://challenges.cloudflare.com/turnstile/v0/siteverify` using the `TURNSTILE_SECRET_KEY` environment variable.
5. A `.env.example` file documents all required environment variables including `TURNSTILE_SECRET_KEY` and `TURNSTILE_SITE_KEY`.
6. All existing 221 tests continue to pass (0 regressions).

## Tasks / Subtasks

- [x] Task 1 — Create `TurnstileGuard` (AC: 1, 2, 4)
  - [x] Create `src/common/guards/turnstile.guard.ts` implementing `CanActivate`
  - [x] Read `turnstileToken` from `request.body` (body is parsed before guards run in NestJS)
  - [x] Throw `UnprocessableEntityException('TURNSTILE_TOKEN_MISSING')` if token absent or empty
  - [x] Call `https://challenges.cloudflare.com/turnstile/v0/siteverify` via native `fetch` (Node 24, no new deps)
  - [x] Throw `UnprocessableEntityException('TURNSTILE_TOKEN_INVALID')` if `data.success !== true`
  - [x] Read `TURNSTILE_SECRET_KEY` via `ConfigService` injection
  - [x] Forward client IP from `X-Forwarded-For` or `request.ip`

- [x] Task 2 — Protect `ApplicationsController.submit()` (AC: 1, 3)
  - [x] Add `@UseGuards(TurnstileGuard)` to `submit()` in `src/applications/applications.controller.ts`
  - [x] Add `@Throttle({ default: { limit: 5, ttl: 3600000 } })` to `submit()`
  - [x] Add `TurnstileGuard` to `ApplicationsModule.providers`
  - [x] Add `turnstileToken?: string` field to `SubmitApplicationDto` in `src/applications/applications.service.ts`

- [x] Task 3 — Protect `ApplicationsController.create()` in TenantsController (AC: 2, 3)
  - [x] Add `@UseGuards(TurnstileGuard)` to `create()` (`@Post(':slug/applications')`) in `src/tenants/tenants.controller.ts`
  - [x] Add `@Throttle({ default: { limit: 5, ttl: 3600000 } })` to `create()`
  - [x] Add `TurnstileGuard` to `TenantsModule.providers`
  - [x] Add `@IsString() @IsNotEmpty() turnstileToken: string` to `CreateApplicationDto` in `src/tenants/dto/tenant.dto.ts`

- [x] Task 4 — Create `.env.example` (AC: 5)
  - [x] Create `.env.example` at project root (does not exist yet)
  - [x] Document all env vars: `DATABASE_URL`, `JWT_SECRET`, `JWT_ACCESS_EXPIRY`, `REDIS_URL`, `REDIS_HOST`, `REDIS_PORT`, `FRONTEND_URL`, `R2_*`, `TURNSTILE_SECRET_KEY`, `TURNSTILE_SITE_KEY`, `SMTP_*`, `EMAIL_FROM`

- [x] Task 5 — Validate (AC: 6)
  - [x] Run `npx tsc --noEmit` → 0 errors
  - [x] Run `npx jest --passWithNoTests` → 221/221 tests pass

## Dev Notes

### Context

This story fixes **Audit finding H6** — `POST /applications` and `POST /properties/:slug/applications` are fully public (no auth, no bot protection) and accept arbitrary form data. A bot could submit thousands of fake applications, spamming property owners.

**Scope:** 1 new guard file + 2 controller modifications + 2 DTO changes + 1 module modification per controller + 1 new `.env.example`. No new npm packages.

---

### Architecture: Two Public Endpoints Being Protected

**Endpoint 1:** `POST /applications` — `ApplicationsController.submit()` in `src/applications/applications.controller.ts`

```typescript
@Post()
@Public()             // JwtAuthGuard bypassed — no JWT required
@HttpCode(HttpStatus.CREATED)
submit(@Body() dto: SubmitApplicationDto) {
  return this.service.submit(dto);
}
```

**Endpoint 2:** `POST /properties/:slug/applications` — `ApplicationsController.create()` in `src/tenants/tenants.controller.ts`
(Note: despite "ApplicationsController", this class is exported from `tenants.controller.ts` and registered in `TenantsModule`)

```typescript
@Public()
@Post(':slug/applications')
create(@Param('slug') slug: string, @Body() dto: CreateApplicationDto) {
  return this.service.createApplication(slug, dto);
}
```

---

### Task 1: `TurnstileGuard` — Full Implementation

File: `src/common/guards/turnstile.guard.ts`

```typescript
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class TurnstileGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      body: Record<string, unknown>;
      ip: string;
      headers: Record<string, string | string[] | undefined>;
    }>();

    const token = request.body['turnstileToken'] as string | undefined;

    if (!token) {
      throw new UnprocessableEntityException('TURNSTILE_TOKEN_MISSING');
    }

    const secret = this.config.get<string>('TURNSTILE_SECRET_KEY');
    const rawIp = request.headers['cf-connecting-ip'] ?? request.headers['x-forwarded-for'] ?? request.ip;
    const remoteip = Array.isArray(rawIp) ? rawIp[0] : rawIp;

    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, response: token, remoteip }),
    });

    const data = (await response.json()) as { success: boolean };

    if (!data.success) {
      throw new UnprocessableEntityException('TURNSTILE_TOKEN_INVALID');
    }

    return true;
  }
}
```

**Key points:**
- `ConfigService` is globally available (`ConfigModule.forRoot({ isGlobal: true })` in `AppModule`) — no need to import `ConfigModule` in the host modules.
- Native `fetch` — Node 24.13.0 is installed, no `@nestjs/axios` or `node-fetch` needed.
- IP extraction: `cf-connecting-ip` (Cloudflare CDN) → `x-forwarded-for` (reverse proxy) → `request.ip` (direct).
- `request.body` is available in guards because Express body-parsing middleware runs before NestJS guards.

---

### Task 2: `ApplicationsController` Changes

**File: `src/applications/applications.controller.ts`**

Add to imports:
```typescript
import { UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { TurnstileGuard } from '../common/guards/turnstile.guard.js';
```

Updated `submit()`:
```typescript
@Post()
@Public()
@UseGuards(TurnstileGuard)
@Throttle({ default: { limit: 5, ttl: 3600000 } })
@HttpCode(HttpStatus.CREATED)
@ApiOperation({ summary: 'Soumettre une candidature locative (public)' })
submit(@Body() dto: SubmitApplicationDto) {
  return this.service.submit(dto);
}
```

**File: `src/applications/applications.module.ts`** — add `TurnstileGuard` to providers:
```typescript
import { TurnstileGuard } from '../common/guards/turnstile.guard.js';

@Module({
  imports: [NotificationsModule],
  controllers: [ApplicationsController],
  providers: [ApplicationsService, TurnstileGuard],  // ← add TurnstileGuard
})
export class ApplicationsModule {}
```

**File: `src/applications/applications.service.ts`** — add `turnstileToken` to `SubmitApplicationDto`:
```typescript
export class SubmitApplicationDto {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  propertyId: string;
  message?: string;
  turnstileToken: string;  // ← ADD (no class-validator decorators — consistent with existing fields)
}
```

Note: `SubmitApplicationDto` has no class-validator decorators on any of its existing fields. Add `turnstileToken` without decorators to stay consistent. The TurnstileGuard itself enforces the presence check before the service is called.

---

### Task 3: `TenantsController` / `CreateApplicationDto` Changes

**File: `src/tenants/tenants.controller.ts`**

Add to imports:
```typescript
import { UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { TurnstileGuard } from '../common/guards/turnstile.guard.js';
```

Updated `create()` in the `ApplicationsController` class (the second controller in this file):
```typescript
@Public()
@UseGuards(TurnstileGuard)
@Throttle({ default: { limit: 5, ttl: 3600000 } })
@Post(':slug/applications')
@ApiOperation({ summary: 'Déposer une candidature' })
create(@Param('slug') slug: string, @Body() dto: CreateApplicationDto) {
  return this.service.createApplication(slug, dto);
}
```

**File: `src/tenants/tenants.module.ts`** — add `TurnstileGuard` to providers:
```typescript
import { TurnstileGuard } from '../common/guards/turnstile.guard.js';

@Module({
  controllers: [TenantsController, ApplicationsController],
  providers: [TenantRepository, TenantsService, TurnstileGuard],  // ← add TurnstileGuard
  exports: [TenantsService, TenantRepository],
})
export class TenantsModule {}
```

**File: `src/tenants/dto/tenant.dto.ts`** — add `turnstileToken` to `CreateApplicationDto`:
```typescript
export class CreateApplicationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tenantId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  message?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  income?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  occupation?: string;

  @ApiProperty()          // ← ADD (required field)
  @IsString()             // ← ADD
  @IsNotEmpty()           // ← ADD
  turnstileToken: string; // ← ADD
}
```

Add `IsNotEmpty` and `ApiProperty` to imports in `tenant.dto.ts` if not already present.

---

### Task 4: `.env.example`

Create `{project-root}/.env.example`:

```dotenv
# ─── Database ─────────────────────────────────────────────────────────────────
DATABASE_URL=postgresql://user:password@localhost:5432/immo_plus

# ─── JWT ──────────────────────────────────────────────────────────────────────
JWT_SECRET=change-me-in-production
JWT_ACCESS_EXPIRY=1h
JWT_REFRESH_EXPIRY=30d

# ─── Frontend ─────────────────────────────────────────────────────────────────
FRONTEND_URL=http://localhost:3000

# ─── Redis (set to true to enable BullMQ + email queue) ───────────────────────
REDIS_ENABLED=false
REDIS_HOST=localhost
REDIS_PORT=6379

# ─── Cloudflare R2 (file storage) ─────────────────────────────────────────────
CLOUDFLARE_R2_ACCOUNT_ID=
CLOUDFLARE_R2_ACCESS_KEY_ID=
CLOUDFLARE_R2_SECRET_ACCESS_KEY=
CLOUDFLARE_R2_BUCKET_NAME=

# ─── Cloudflare Turnstile (anti-bot for public forms) ─────────────────────────
# Get keys at: https://dash.cloudflare.com/ → Turnstile
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA  # test key (always passes)
TURNSTILE_SITE_KEY=1x00000000000000000000AA                # test key (for frontend)

# ─── SMTP (email delivery) ────────────────────────────────────────────────────
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=noreply@example.com
```

---

### Guard Chain Reference

```
ThrottlerGuard (global) → JwtAuthGuard (global) → RolesGuard (global)
  → TurnstileGuard (@UseGuards on method) → service
```

For the two public endpoints:
1. **ThrottlerGuard**: enforces 5 req/hr (via `@Throttle` override) — blocks at 6th request with 429
2. **JwtAuthGuard**: returns `true` immediately because `@Public()` metadata is set
3. **RolesGuard**: returns `true` because no `@Roles` metadata on these endpoints
4. **TurnstileGuard**: validates `body.turnstileToken` — throws 422 if missing/invalid

---

### `@Throttle` Decorator — Verified Syntax

The global ThrottlerModule config `[{ ttl: 60000, limit: 200 }]` uses name `'default'` internally (confirmed from `throttler.guard.js`: `name: opt.name ?? 'default'`).

The `@Throttle` decorator stores metadata keyed by throttler name:
```javascript
// from throttler.decorator.js:
Reflect.defineMetadata(THROTTLER_LIMIT + name, options[name].limit, target);
```

So to override the `'default'` throttler, use:
```typescript
@Throttle({ default: { limit: 5, ttl: 3600000 } })  // 5 req per hour
```

---

### Import Path Convention (TypeScript nodenext)

```typescript
// ✅ Correct — .js extension on relative imports
import { TurnstileGuard } from '../common/guards/turnstile.guard.js';

// ❌ Wrong — missing .js extension causes module resolution error at runtime
import { TurnstileGuard } from '../common/guards/turnstile.guard';
```

---

### DTOs: What to Change and What to Preserve

**`SubmitApplicationDto`** — bare class, no class-validator decorators on any field:
```typescript
// src/applications/applications.service.ts — lines 13-20
export class SubmitApplicationDto {
  firstName: string;       // no @IsString — this is the existing pattern
  lastName: string;
  email: string;
  phone?: string;
  propertyId: string;
  message?: string;
  turnstileToken: string;  // ← ADD — no decorator (consistent with existing pattern)
}
```

Do NOT add class-validator decorators to any field of `SubmitApplicationDto` — the existing fields have none and adding them selectively would be inconsistent.

**`CreateApplicationDto`** — uses class-validator decorators on every field:
```typescript
// src/tenants/dto/tenant.dto.ts — add to end of class
@ApiProperty()
@IsString()
@IsNotEmpty()
turnstileToken: string;  // ← ADD — with validators (consistent with existing pattern)
```

---

### Existing Tests — No Changes Needed

The 221 existing unit tests test service logic in isolation. None of them:
- Make HTTP requests to the two protected endpoints
- Instantiate `ApplicationsModule` or `TenantsModule` directly
- Need to mock `TurnstileGuard`

Adding `TurnstileGuard` as a provider in the modules does NOT affect unit tests because unit tests use `Test.createTestingModule()` which builds only the providers listed in the test module config.

If a future test for these endpoints were added, it would need:
```typescript
// In test module setup:
{ provide: TurnstileGuard, useValue: { canActivate: () => true } }
```

But no such test needs to be added in this story.

---

### Anti-Patterns to Avoid

```typescript
// ❌ NEVER — register TurnstileGuard as APP_GUARD (global) — would break ALL public endpoints
// including GET /properties (public listing), GET /agencies/:id/public
{ provide: APP_GUARD, useClass: TurnstileGuard }

// ❌ NEVER — skip @UseGuards and call TurnstileService directly in the controller
// Guards are the correct NestJS abstraction for cross-cutting security concerns
async submit(@Body() dto: SubmitApplicationDto) {
  await this.turnstileService.verify(dto.turnstileToken); // ← wrong layer
  return this.service.submit(dto);
}

// ❌ NEVER — use @nestjs/axios (not installed) instead of native fetch
import { HttpService } from '@nestjs/axios'; // ← not installed, causes startup error

// ✅ CORRECT — native fetch (Node 24.13.0 is confirmed available)
const response = await fetch('https://challenges.cloudflare.com/...');
```

```typescript
// ❌ NEVER — mark TurnstileGuard as global in the guard itself
// @Throttle on specific endpoint is the correct override; don't touch global config
ThrottlerModule.forRoot([{ ttl: 60000, limit: 5 }]) // ← would affect ALL endpoints

// ✅ CORRECT — override per-endpoint only
@Throttle({ default: { limit: 5, ttl: 3600000 } }) // ← only this endpoint
```

---

### Previous Story Learnings (from 10.1–10.3)

- **TypeScript nodenext**: ALL relative imports require `.js` extension — applies to the new guard import in controllers and modules
- **ConfigService global**: `ConfigModule.forRoot({ isGlobal: true })` in `AppModule` — no need to import `ConfigModule` in host modules
- **Never add debug `console.log`** under any circumstances
- **SubmitApplicationDto** has no class-validator decorators — match the existing pattern when adding `turnstileToken`
- **CreateApplicationDto** uses class-validator on all fields — add `@IsString() @IsNotEmpty()` to `turnstileToken`
- **Verify tsc + jest before marking complete**: `npx tsc --noEmit` → 0 errors, `npx jest --passWithNoTests` → 221 pass

## Dev Agent Record

### Completion Notes

- `TurnstileGuard` créé dans `src/common/guards/turnstile.guard.ts` — utilise `fetch` natif (Node 24), `ConfigService` global, lit IP depuis `cf-connecting-ip` → `x-forwarded-for` → `request.ip`.
- `SubmitApplicationDto.turnstileToken` défini optionnel (`?: string`) car : (a) le service ne lit pas ce champ, (b) le guard le lit depuis `request.body` directement avant la désérialisation du DTO, (c) `SubmitApplicationDto` n'a pas de décorateurs class-validator — rendre le champ optionnel évite de modifier les 8 objets de test dans `applications.service.spec.ts`.
- `CreateApplicationDto.turnstileToken` défini requis avec `@IsString() @IsNotEmpty()` — cohérent avec les autres champs de ce DTO qui utilisent class-validator.
- `@Throttle({ default: { limit: 5, ttl: 3600000 } })` confirmé par inspection du source `throttler.decorator.js` : la clé `'default'` correspond au nom interne du throttler global (assigné par `opt.name ?? 'default'` dans `throttler.guard.js`).
- `.env.example` créé à la racine avec toutes les variables d'environnement du projet.
- `tsc --noEmit` → 0 erreur. Jest → **221/221 tests passés, 0 régression**.

### Debug Log

| Date | Problème | Solution |
|------|----------|----------|
| 2026-06-14 | `tsc` : `turnstileToken` requis manquant dans 8 fixtures de test | Changé `turnstileToken: string` → `turnstileToken?: string` dans `SubmitApplicationDto` (champ non lu par le service, validé uniquement par le guard via `request.body`) |

## Change Log

| Date | Type | Description |
|------|------|-------------|
| 2026-06-14 | feat | Création TurnstileGuard (src/common/guards/turnstile.guard.ts) avec fetch natif + ConfigService |
| 2026-06-14 | feat | Protection POST /applications : @UseGuards(TurnstileGuard) + @Throttle 5/h |
| 2026-06-14 | feat | Protection POST /properties/:slug/applications : @UseGuards(TurnstileGuard) + @Throttle 5/h |
| 2026-06-14 | feat | Ajout turnstileToken aux DTOs SubmitApplicationDto et CreateApplicationDto |
| 2026-06-14 | feat | Création .env.example avec toutes les variables d'environnement documentées |

## File List

- `src/common/guards/turnstile.guard.ts` — NEW (TurnstileGuard using native fetch)
- `src/applications/applications.controller.ts` — MODIFY (add @UseGuards + @Throttle to submit)
- `src/applications/applications.module.ts` — MODIFY (add TurnstileGuard to providers)
- `src/applications/applications.service.ts` — MODIFY (add turnstileToken to SubmitApplicationDto)
- `src/tenants/tenants.controller.ts` — MODIFY (add @UseGuards + @Throttle to create in ApplicationsController)
- `src/tenants/tenants.module.ts` — MODIFY (add TurnstileGuard to providers)
- `src/tenants/dto/tenant.dto.ts` — MODIFY (add turnstileToken to CreateApplicationDto)
- `.env.example` — NEW (document all environment variables)
