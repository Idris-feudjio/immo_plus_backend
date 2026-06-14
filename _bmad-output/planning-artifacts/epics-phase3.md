---
stepsCompleted: [1, 2, 3, 4]
inputDocuments:
  - "_bmad-output/planning-artifacts/prds/prd-immo-plus-backend-2026-06-14/prd.md"
  - "_bmad-output/planning-artifacts/architecture.md"
  - "_bmad-output/project-context.md"
parentEpics: "_bmad-output/planning-artifacts/epics.md"
epicRange: "EP-10 to EP-16"
frRange: "FR-46 to FR-58"
nfrRange: "NFR-7, NFR-8, NFR-9"
---

# Immo Plus CM — Phase 3 Hardening & Completion — Epic Breakdown

## Overview

This document covers Phase 3 epics and stories, decomposing FR-46 through FR-58 and NFR-7/8/9 from the Phase 3 PRD (`prd-immo-plus-backend-2026-06-14`). Epic numbering continues from the Phase 1-2 epics (EP-0 → EP-9, 66 stories). New epics start at **EP-10**.

---

## Requirements Inventory

### Functional Requirements

```
FR-46: Livraison sécurisée des OTP et liens de réinitialisation via email queue (pas de console.log)
FR-47: Couverture RBAC — @Roles explicite sur tous les endpoints @Delete/@Post/@Patch/@Put
FR-48: Normalisation des emails en minuscules à l'inscription et à la connexion
FR-49: Protection anti-bot Cloudflare Turnstile + throttler 5/h sur les formulaires publics
FR-50: Upload d'images de propriété effectivement persisté dans Cloudflare R2
FR-51: Upload de photos de maintenance effectivement persisté dans Cloudflare R2
FR-52: Validation MIME type + taille avant tout upload (images: 5 Mo, documents: 10 Mo)
FR-53: Validation startDate < endDate lors de la création d'un contrat
FR-54: Contrainte @@unique([contractId, period]) sur la table Payment
FR-55: Taux de TVA configurable dans AdminSettings, rétroactif sur commissions PENDING
FR-56: Templates email HTML brandés pour tous les types de notifications transactionnelles
FR-57: Calcul des charges/fees par propriété sur période — GET /documents/fees
FR-58: Calcul du ROI annualisé par propriété — GET /documents/roi
```

### Non-Functional Requirements

```
NFR-7: Aucune donnée sensible (OTP, token, secret) dans les logs applicatifs
NFR-8: Aucun cast `as never` / `as any` dans le code de production
NFR-9: Couverture tests unitaires ≥ 80% branches sur AuthService (critique), UsersService (haute), NotificationsService / CacheService / StorageService (moyenne) + tests d'intégration sur 3 flux end-to-end
```

### Additional Requirements (Architecture & Project Context)

```
- Guard chain: ThrottlerGuard → JwtAuthGuard → RolesGuard → MandateGuard → ownership check in service
- StorageService.uploadBuffer(key, buffer, contentType) → returns URL ; StorageService.delete(key)
- Clés R2 images: properties/{propertyId}/images/{imageId}.{ext}
- Clés R2 maintenance: maintenance/{requestId}/photos/{photoId}.{ext}
- BullMQ email job shape: { to, subject, template, data } ; attempts: 3 ; backoff exponentiel 5s
- Turnstile vérification: POST https://challenges.cloudflare.com/turnstile/v0/siteverify
- TVA snapshot pattern: tvaRate + tvaAmount + amountTTC stockés sur Commission à la création
- Commissions PAID et CANCELLED sont immuables — seules les PENDING sont recalculables
- PrismaService via PrismaPg adapter (jamais PrismaClient direct)
- UnitOfWork pour toute opération multi-tables
- Toutes les exceptions: NestJS standard (BadRequestException, NotFoundException, etc.)
```

### UX Design Requirements

*Aucun document UX disponible — backend API uniquement.*

### FR Coverage Map

| FR | Epic | Story |
|----|------|-------|
| FR-46 | EP-10 | 10.1 |
| FR-47 | EP-10 | 10.2 |
| FR-48 | EP-10 | 10.3 |
| FR-49 | EP-10 | 10.4 |
| FR-50 | EP-11 | 11.1 |
| FR-51 | EP-11 | 11.2 |
| FR-52 | EP-11 | 11.3 |
| FR-53 | EP-12 | 12.1 |
| FR-54 | EP-12 | 12.2 |
| FR-55 | EP-13 | 13.1 |
| FR-56 | EP-14 | 14.1, 14.2 |
| FR-57 | EP-15 | 15.1 |
| FR-58 | EP-15 | 15.2 |
| NFR-7 | EP-10 | 10.1 |
| NFR-8 | EP-16 | 16.4 |
| NFR-9 | EP-16 | 16.1, 16.2, 16.3, 16.5 |

---

## Epic List

| Epic | Titre | Stories | FRs |
|------|-------|---------|-----|
| EP-10 | Security Hardening | 4 | FR-46, FR-47, FR-48, FR-49, NFR-7 |
| EP-11 | File Storage Completion | 3 | FR-50, FR-51, FR-52 |
| EP-12 | Data Integrity | 2 | FR-53, FR-54 |
| EP-13 | Business Configuration | 1 | FR-55 |
| EP-14 | Communication Quality | 2 | FR-56 |
| EP-15 | Analytics Completion | 2 | FR-57, FR-58 |
| EP-16 | Code Quality & Test Coverage | 5 | NFR-8, NFR-9 |

**Total : 7 nouveaux épics, 19 stories (EP-10 story 10.1 → EP-16 story 16.5)**

---

## Epic 10: Security Hardening

**Goal:** Eliminate all critical and high-severity security findings before any real-tenant traffic. Every story in this epic is P1 — nothing ships to production until EP-10 is complete.

**Dependencies:** None. All stories are independent and can be parallelized.

---

### Story 10.1: Secure OTP & reset token delivery

As a **system operator**,
I want OTP codes and password-reset links delivered via the email queue instead of `console.log`,
So that sensitive tokens are never exposed in application logs or CI/CD pipelines.

**Source:** FR-46, NFR-7 — Audit C1 (`auth.service.ts:68`)

**Acceptance Criteria:**

**Given** a user calls `POST /auth/send-otp`
**When** `AuthService.sendOtp()` executes
**Then** an email job `{ to, subject, template: 'otp', data: { otp } }` is enqueued via `EmailQueueService`
**And** no OTP value appears in any application log line (Logger or console)

**Given** a user calls `POST /auth/forgot-password`
**When** `AuthService.sendPasswordResetLink()` executes
**Then** an email job is enqueued with the reset URL in `data`
**And** no reset URL appears in any log output

**Given** `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` are absent from the environment
**When** the email job is processed by `NotificationsProcessor`
**Then** the job completes without error (nodemailer no-ops gracefully)
**And** no sensitive data is written to stdout

**Dev Notes:**
- Remove the `console.log(otp)` and `console.log(resetLink)` lines in `auth.service.ts:68`
- `EmailQueueService.sendEmail({ to, subject, template, data })` is the injection point
- BullMQ job config: `{ attempts: 3, backoff: { type: 'exponential', delay: 5000 } }`

---

### Story 10.2: RBAC enforcement on all mutating endpoints

As a **security auditor**,
I want every mutating API endpoint to carry an explicit `@Roles(...)` decorator,
So that no authenticated user can perform privileged actions beyond their designated role.

**Source:** FR-47 — Audit C2 (`agencies.controller.ts`)

**Acceptance Criteria:**

**Given** an authenticated `TENANT` user
**When** `DELETE /agencies/:id/members/:memberId` is called
**Then** the response is `HTTP 403 Forbidden`

**Given** an authenticated `OWNER` user who owns the agency
**When** `DELETE /agencies/:id/members/:memberId` is called
**Then** the member is removed and the response is `HTTP 200`

**Given** an authenticated `ADMIN` user
**When** `DELETE /agencies/:id/members/:memberId` is called
**Then** the member is removed and the response is `HTTP 200`

**Given** a code review pass over all controllers
**When** every `@Delete`, `@Post`, `@Patch`, `@Put` decorated method is checked
**Then** each carries either `@Roles(Role.X, ...)` or `@Public()` — none is implicitly open

**Dev Notes:**
- Primary fix: add `@Roles(Role.OWNER, Role.ADMIN)` to `AgenciesController.removeMember()`
- Secondary: do a full audit sweep of all controller files — grep for `@Delete\|@Post\|@Patch\|@Put` and verify each has `@Roles` or `@Public`
- Guard chain is global: ThrottlerGuard → JwtAuthGuard → RolesGuard; `@Roles` is enforced by the existing `RolesGuard`

---

### Story 10.3: Email address normalization to lowercase

As a **registered user**,
I want my email address stored in lowercase regardless of how I typed it,
So that I can always log in without caring about capitalization.

**Source:** FR-48 — Audit H5 (`auth.service.ts`)

**Acceptance Criteria:**

**Given** a registration request with email `"Owner@ImmoPlusCM.com"`
**When** `AuthService.register()` processes the DTO
**Then** the persisted user email is `"owner@immopluscm.com"`

**Given** a login request with email `"OWNER@IMMOPLUSCM.COM"` and the correct password
**When** `AuthService.login()` processes the DTO
**Then** authentication succeeds by normalizing to `"owner@immopluscm.com"` before the database lookup

**Given** the email normalization migration is applied
**When** querying all users
**Then** every user email in the database is lowercase (no mixed-case entries remain)

**Dev Notes:**
- Add `.toLowerCase()` to `dto.email` in both `register()` and `login()` — before any DB operation
- Write a Prisma migration: `UPDATE "users" SET email = LOWER(email)` — idempotent
- Unique index on `email` already exists; migration does not need to recreate it

---

### Story 10.4: Cloudflare Turnstile anti-bot protection on public forms

As a **product owner**,
I want public rental application endpoints protected by Cloudflare Turnstile,
So that automated bots cannot spam the application pipeline.

**Source:** FR-49 — Audit H3

**Acceptance Criteria:**

**Given** a request to `POST /applications` with a valid Turnstile token in `body.turnstileToken`
**When** the backend calls `POST https://challenges.cloudflare.com/turnstile/v0/siteverify` with `{ secret: TURNSTILE_SECRET_KEY, response: token }`
**Then** the API returns `{ success: true }` and the application is processed normally

**Given** a request with a missing or invalid Turnstile token
**When** `POST /applications` or `POST /tenants/:slug/applications` is called
**Then** the response is `HTTP 422 Unprocessable Entity` before any business logic runs

**Given** a valid Turnstile token but the same IP has submitted 5 applications within the last hour
**When** a 6th submission is attempted
**Then** the response is `HTTP 429 Too Many Requests` with a `Retry-After` header

**Given** the application starts
**When** the environment variables `TURNSTILE_SECRET_KEY` and `TURNSTILE_SITE_KEY` are read
**Then** they are injected via `ConfigService` (not hardcoded)

**Dev Notes:**
- Create `TurnstileGuard` implementing `CanActivate`; inject `HttpService` (Axios) to call the siteverify endpoint
- Apply `TurnstileGuard` to the two public application endpoints only
- The per-IP throttler uses `@nestjs/throttler` with a dedicated `TtlLimitOptions` override (5 requests / 3600s)
- Add `turnstileToken: string` field to the public application DTOs
- Add `TURNSTILE_SECRET_KEY` and `TURNSTILE_SITE_KEY` to `.env.example`

---

## Epic 11: File Storage Completion

**Goal:** Wire actual Cloudflare R2 storage for property images and maintenance photos. Add centralized MIME/size validation that fires before any storage call.

**Dependencies:** `StorageModule` / `StorageService` already exist and are injected globally.

---

### Story 11.1: Property image upload wired to Cloudflare R2

As a **property owner**,
I want the images I upload for my properties actually stored in Cloudflare R2,
So that they persist across deployments and are accessible via real URLs.

**Source:** FR-50 — Audit C4 (`properties.controller.ts:125`)

**Acceptance Criteria:**

**Given** a valid JPEG image buffer uploaded via `POST /properties/:id/images`
**When** `PropertiesController.addImages()` processes the request
**Then** `StorageService.uploadBuffer("properties/{propertyId}/images/{imageId}.jpg", buffer, "image/jpeg")` is called
**And** the returned URL is stored on the `PropertyImage` record

**Given** a property has 3 images and `DELETE /properties/:id/images/:imageId` is called
**When** the controller processes the deletion
**Then** `StorageService.delete("properties/{propertyId}/images/{imageId}.{ext}")` is called before the DB record is removed

**Given** a property with uploaded images
**When** `GET /properties/:id` is called
**Then** all image URLs in the response are real R2 URLs (not placeholder strings like `"placeholder-url"`)

**Given** the first image is uploaded to a property with no existing images
**When** the upload completes
**Then** that image is automatically set as the cover (`isCover: true`)

**Dev Notes:**
- Replace TODO stub in `properties.controller.ts:125` with actual `storageService.uploadBuffer()` call
- `imageId` = `uuidv4()` generated before the upload call
- Extension derived from `file.mimetype`: `image/jpeg` → `jpg`, `image/png` → `png`, `image/webp` → `webp`
- Inject `StorageService` into `PropertiesController` or `PropertiesService` (prefer service layer)

---

### Story 11.2: Maintenance photo upload wired to Cloudflare R2

As a **tenant or owner**,
I want maintenance request photos actually stored in Cloudflare R2,
So that maintenance evidence is preserved and accessible to property managers.

**Source:** FR-51 — Audit C4 (`maintenance.controller.ts:82`)

**Acceptance Criteria:**

**Given** a valid image buffer uploaded via `POST /maintenance/:id/photos`
**When** `MaintenanceController.uploadPhotos()` processes the request
**Then** `StorageService.uploadBuffer("maintenance/{requestId}/photos/{photoId}.{ext}", buffer, mimetype)` is called
**And** the returned URL is stored on the maintenance request's photos array

**Given** a maintenance request with uploaded photos
**When** `GET /maintenance/:id` is called
**Then** all photo URLs in the response are real R2 URLs

**Dev Notes:**
- Replace TODO stub in `maintenance.controller.ts:82` with actual `storageService.uploadBuffer()` call
- `photoId` = `uuidv4()`
- Inject `StorageService` into `MaintenanceService`

---

### Story 11.3: Centralized file upload MIME and size validation

As a **system**,
I want all file upload endpoints to reject invalid files before any storage call,
So that Cloudflare R2 is never polluted with wrong file types or oversized uploads.

**Source:** FR-52 — Audit C3 (all controllers with `FileInterceptor`)

**Acceptance Criteria:**

**Given** a file with MIME type `"text/plain"` uploaded to `POST /properties/:id/images`
**When** the `FileValidationPipe` runs
**Then** `HTTP 415 Unsupported Media Type` is returned before `StorageService` is called

**Given** a valid JPEG file of 6 MB uploaded to any image endpoint
**When** the `FileValidationPipe` runs
**Then** `HTTP 413 Content Too Large` is returned before `StorageService` is called

**Given** a `application/msword` file uploaded to a document endpoint
**When** the `FileValidationPipe` runs
**Then** `HTTP 415 Unsupported Media Type` is returned

**Given** a valid PDF file of 8 MB uploaded to a document endpoint
**When** the `FileValidationPipe` runs
**Then** `HTTP 413 Content Too Large` is returned (max 10 MB for documents)

**Given** a valid JPEG file of 3 MB uploaded to `POST /properties/:id/images`
**When** the `FileValidationPipe` runs
**Then** validation passes and the file proceeds to the controller

**Dev Notes:**
- Create `src/common/pipes/file-validation.pipe.ts` implementing `PipeTransform`
- Constructor params: `allowedMimeTypes: string[]`, `maxSizeBytes: number`
- Image preset: `new FileValidationPipe(['image/jpeg','image/png','image/webp'], 5 * 1024 * 1024)`
- Document preset: `new FileValidationPipe(['application/pdf'], 10 * 1024 * 1024)`
- Apply via `@UploadedFile(new FileValidationPipe(...))` on each endpoint
- This replaces Story 11.1 and 11.2's individual validation if those were written inline

---

## Epic 12: Data Integrity

**Goal:** Add the missing database constraint and input validation that the audit identified as data-corruption risks.

---

### Story 12.1: Contract date range validation

As a **system**,
I want contract creation to reject `startDate >= endDate`,
So that temporally invalid contracts can never enter the system.

**Source:** FR-53 — Audit M8

**Acceptance Criteria:**

**Given** a `CreateContractDto` with `startDate: "2026-07-01"` and `endDate: "2026-06-01"`
**When** `POST /contracts` is called
**Then** the response is `HTTP 400 Bad Request`
**And** the message is `"La date de début doit être antérieure à la date de fin."`

**Given** a `CreateContractDto` with `startDate === endDate`
**When** `POST /contracts` is called
**Then** `HTTP 400 Bad Request` is returned (same-day contracts are invalid)

**Given** a `CreateContractDto` with `startDate: "2026-06-01"` and `endDate: "2026-12-31"`
**When** `POST /contracts` is called
**Then** contract creation proceeds normally (valid range passes)

**Dev Notes:**
- Add the validation in `ContractsService.create()`, before any DB call
- Pattern: `if (new Date(dto.startDate) >= new Date(dto.endDate)) throw new BadRequestException(...)`
- Do NOT add this validation to the DTO with `class-validator` — it crosses field boundaries and belongs in the service

---

### Story 12.2: Unique payment period database constraint

As a **system**,
I want the `(contractId, period)` pair to be unique in the `Payment` table,
So that duplicate payment schedule entries are structurally impossible.

**Source:** FR-54 — Audit H6

**Acceptance Criteria:**

**Given** a Prisma migration `AddUniquePaymentPeriod` is applied
**When** the `Payment` table schema is inspected
**Then** a unique index on `(contractId, period)` exists

**Given** an attempt to insert a second `Payment` with `contractId = "X"` and `period = "2026-07"`
**When** `prisma.payment.create()` executes
**Then** a `ConflictException` (HTTP 409) is thrown with message `"Une entrée de paiement existe déjà pour cette période."`
**And** the raw Prisma `P2002` error is not exposed to the client

**Given** `buildPaymentSchedule()` generates 12 payments for a new annual contract
**When** `ContractsService.create()` runs inside a `UnitOfWork` transaction
**Then** all 12 payments are inserted successfully (no period collision on a fresh contract)

**Dev Notes:**
- Add `@@unique([contractId, period])` to the `Payment` model in `schema.prisma`
- Run `prisma migrate dev --name add_unique_payment_period`
- Wrap Prisma `P2002` error in `ContractRepository.createPayment()` (or service) → `ConflictException`
- `period` format is `"YYYY-MM"` (e.g. `"2026-07"`) — verify `buildPaymentSchedule()` uses this format consistently

---

## Epic 13: Business Configuration

**Goal:** Make the TVA rate administratively configurable so a regulatory change does not require a code deployment.

---

### Story 13.1: Configurable TVA rate in AdminSettings

As an **Admin**,
I want to update the TVA rate through an API endpoint,
So that commission calculations stay accurate if the Cameroonian tax authority changes the applicable rate.

**Source:** FR-55 — Audit H1, Assumption A-7 (parent PRD) → CLOSED

**Acceptance Criteria:**

**Given** a Prisma migration adds `tvaRate Decimal @default(19.25)` to `AdminSettings`
**When** the application starts for the first time after migration
**Then** `AdminSettings.tvaRate` is `19.25`

**Given** `CommissionsService.create()` is called
**When** a new commission is generated (auto-management or manual)
**Then** `tvaRate` is read from `AdminSettings` via `AdminService.getSettings()`
**And** stored as a snapshot on `Commission.tvaRate`

**Given** an `ADMIN` user calls `PATCH /admin/settings` with `{ tvaRate: 18.0 }`
**When** the request is processed
**Then** `AdminSettings.tvaRate` is updated to `18.0`
**And** the response returns the updated settings object

**Given** `PATCH /admin/settings` is called with `{ tvaRate: 150 }` (out of [0, 100] range)
**When** the request is validated
**Then** `HTTP 400 Bad Request` is returned

**Given** the TVA rate is updated from `19.25` to `18.0`
**When** the update is applied
**Then** all `Commission` records with `status = PENDING` are updated: `tvaRate = 18.0`, `tvaAmount = round(amountHT * 18.0 / 100)`, `amountTTC = amountHT + tvaAmount`
**And** commissions with `status = PAID` or `status = CANCELLED` are NOT modified

**Given** a `MANAGER` user calls `PATCH /admin/settings`
**When** the request is received
**Then** `HTTP 403 Forbidden` is returned (Admin-only endpoint)

**Dev Notes:**
- `AdminSettings` model likely already exists; add `tvaRate Decimal @default(19.25)` field via migration
- The recalculation on PENDING commissions must run inside a `UnitOfWork` transaction with the settings update
- `amountTTC` and `tvaAmount` use `Math.round()` (integer FCFA)
- Cache invalidation: if `AdminSettings` is cached in `CacheService`, invalidate the cache key after update

---

## Epic 14: Communication Quality

**Goal:** Replace bare HTML string arrays in `NotificationsProcessor` with structured, branded email templates that represent Immo Plus CM's visual identity.

---

### Story 14.1: Email template infrastructure and auth notification templates

As a **user**,
I want OTP and password-reset emails to be visually consistent with the Immo Plus CM brand,
So that I recognize and trust the platform's automated communications.

**Source:** FR-56.1 to FR-56.5 — Audit H2

**Acceptance Criteria:**

**Given** `src/notifications/templates/` directory is created
**When** the module initializes
**Then** it contains: `base.layout.html`, `otp.html`, `password-reset.html`

**Given** `base.layout.html` includes `{{content}}` placeholder, Immo Plus CM logo (from env or asset path), primary brand color, and footer with contact info
**When** any child template is rendered
**Then** the base layout wraps the content consistently

**Given** `otp.html` template with `{{ name }}` and `{{ otp }}` placeholders
**When** `NotificationsProcessor` renders an OTP email
**Then** the correct name and OTP are substituted before the job is sent

**Given** a multipart email is constructed
**When** it is passed to the nodemailer transport
**Then** both `html` and `text` parts are present (plain-text fallback)

**Given** any email subject line
**When** the email is sent
**Then** the subject is in French (e.g. `"Votre code de vérification Immo Plus CM"`)

**Dev Notes:**
- Use a simple string `replace()` or a minimal template engine (e.g. `Handlebars`) for `{{ variable }}` substitution
- Store brand assets path in `ConfigService` (e.g. `BRAND_LOGO_URL`)
- Templates are static HTML files read at module init — no runtime file I/O per email
- `NotificationsProcessor` injects `ConfigService` for the logo URL

---

### Story 14.2: Transactional notification templates

As a **tenant or owner**,
I want payment confirmations, contract events, and maintenance updates to arrive as readable, branded emails,
So that I can act on them without confusion.

**Source:** FR-56 — all notification types beyond auth

**Acceptance Criteria:**

**Given** a payment is registered and `PaymentConfirmedEvent` fires
**When** `NotificationsProcessor` handles the `send-email` job for payment confirmation
**Then** the email uses `payment-confirmation.html` with `{{ tenantName }}`, `{{ amount }}`, `{{ period }}`, `{{ propertyName }}` substituted

**Given** a contract is created and the tenant notification email is enqueued
**When** `NotificationsProcessor` handles it
**Then** the email uses `contract-created.html` with `{{ tenantName }}`, `{{ propertyName }}`, `{{ startDate }}`, `{{ endDate }}` substituted

**Given** a maintenance request status changes to `IN_PROGRESS` or `RESOLVED`
**When** the notification email is enqueued
**Then** the email uses `maintenance-update.html` with `{{ status }}`, `{{ urgency }}`, `{{ propertyName }}` substituted

**Given** all templates
**When** rendered
**Then** each includes the base layout (logo, footer) and a plain-text fallback

**Dev Notes:**
- Templates to create: `payment-confirmation.html`, `contract-created.html`, `maintenance-update.html`
- Reuse the same `renderTemplate(templateName, data)` helper from Story 14.1
- Update `NotificationsProcessor` to switch on `job.data.template` and call `renderTemplate()` for each case

---

## Epic 15: Analytics Completion

**Goal:** Implement the two remaining calculation stubs in `DocumentsService` to give owners visibility into property charges and ROI.

---

### Story 15.1: Property fees and charges calculation

As a **property owner**,
I want to query the total charges on a property over a date range,
So that I can understand the true cost of operating each asset.

**Source:** FR-57 — Audit TODO `documents.service.ts:38`

**Acceptance Criteria:**

**Given** `GET /documents/fees?propertyId=X&from=2026-01-01&to=2026-12-31` called by an `OWNER`
**When** `DocumentsService.calculateFees()` runs
**Then** the response contains:
```json
{
  "maintenanceCosts": 150000,
  "placementCommissions": 50000,
  "managementCommissions": 120000,
  "total": 320000
}
```

**Given** an `OWNER` querying a property they do not own
**When** `GET /documents/fees` is called
**Then** `HTTP 403 Forbidden` is returned

**Given** a `TENANT` user
**When** `GET /documents/fees` is called
**Then** `HTTP 403 Forbidden` is returned

**Given** a propertyId with no charges in the given period
**When** `GET /documents/fees` is called
**Then** all amounts are `0` (not an error or null response)

**Dev Notes:**
- `maintenanceCosts`: sum of maintenance requests costs (if a `cost` field exists on MaintenanceRequest) for the property in the period — if no cost field, return `0` and log a TODO
- `placementCommissions`: sum of `Commission.amountTTC` where `type = PLACEMENT` and `commission.contract.propertyId = propertyId` and `createdAt` in range
- `managementCommissions`: sum of `Commission.amountTTC` where `type = MANAGEMENT` in same scope
- All amounts in FCFA (integer)
- Ownership check: `property.ownerId === currentUser.id`

---

### Story 15.2: Property ROI calculation

As a **property owner**,
I want to calculate my property's annualized return on investment,
So that I can benchmark my portfolio against alternatives.

**Source:** FR-58 — Audit TODO `documents.service.ts:135`

**Acceptance Criteria:**

**Given** `GET /documents/roi?propertyId=X&purchasePrice=5000000` called by the property `OWNER`
**When** `DocumentsService.calculateRoi()` runs
**Then** the response contains:
```json
{
  "annualRevenue": 1200000,
  "annualFees": 320000,
  "annualNetRevenue": 880000,
  "purchasePrice": 5000000,
  "roiPercent": 17.6
}
```

**Given** `purchasePrice = 0` in the query
**When** `GET /documents/roi` is called
**Then** `HTTP 400 Bad Request` is returned with message `"Le prix d'achat doit être supérieur à zéro."`

**Given** a `MANAGER` or `TENANT` user
**When** `GET /documents/roi` is called
**Then** `HTTP 403 Forbidden` is returned

**Given** a property with less than 12 months of data
**When** `GET /documents/roi` is called
**Then** the response annualizes based on available data months (prorated)
**And** includes a `dataMonths` field indicating how many months were used

**Dev Notes:**
- `annualRevenue` = sum of `Payment.amount` where `status = PAID` and `payment.contract.propertyId = propertyId` for the past 12 months (or available period)
- `annualFees` = `calculateFees()` result for the same period
- `annualNetRevenue` = `annualRevenue - annualFees`
- `roiPercent` = `Math.round((annualNetRevenue / purchasePrice) * 100 * 100) / 100` (2 decimal places)
- Division-by-zero guard: throw `BadRequestException` if `purchasePrice <= 0`

---

## Epic 16: Code Quality & Test Coverage

**Goal:** Bring critical services to ≥80% branch coverage, implement end-to-end integration tests for core flows, and eliminate unsafe TypeScript casts.

---

### Story 16.1: AuthService unit tests

As a **developer**,
I want `AuthService` covered by unit tests at ≥80% branch coverage,
So that authentication regressions are caught automatically before any deployment.

**Source:** NFR-9 (Critical) — Audit missing test coverage

**Acceptance Criteria:**

**Given** `src/auth/auth.service.spec.ts` exists with full test suite
**When** `npx jest --coverage src/auth/auth.service.ts` runs
**Then** branch coverage for `auth.service.ts` is ≥ 80%

**Given** `register()` is called with an email that already exists
**When** the test runs
**Then** `ConflictException` is thrown and the test asserts it

**Given** `login()` is called with an incorrect password
**When** the test runs
**Then** `UnauthorizedException` is thrown

**Given** `verifyOtp()` is called after 3 failed attempts within 10 minutes
**When** the test runs
**Then** the OTP is marked invalid and `BadRequestException` is thrown on the 4th attempt

**Given** `refreshToken()` is called with an expired or revoked token
**When** the test runs
**Then** `UnauthorizedException` is thrown

**Given** `forgotPassword()` is called with a non-existent email
**When** the test runs
**Then** the response is identical to a success (anti-enumeration — no error thrown)

**Dev Notes:**
- Use `jest.mock` for PrismaService, EmailQueueService, JwtService, CacheService
- Do NOT use real Redis or DB — pure unit test
- Cover all branches: success path, conflict, wrong password, OTP expiry, OTP max attempts, refresh revocation, anti-enumeration

---

### Story 16.2: UsersService unit tests

As a **developer**,
I want `UsersService` covered by unit tests at ≥80% branch coverage,
So that user management regressions are caught before deployment.

**Source:** NFR-9 (High) — Audit missing test coverage

**Acceptance Criteria:**

**Given** `src/users/users.service.spec.ts` exists
**When** `npx jest --coverage src/users/users.service.ts` runs
**Then** branch coverage is ≥ 80%

**Given** `updateUser()` is called by a `MANAGER` on a user that is not themselves
**When** the test runs
**Then** `ForbiddenException` is thrown

**Given** `deactivateUser()` is called by `ADMIN` targeting themselves
**When** the test runs
**Then** `BadRequestException` is thrown (admin cannot deactivate self)

**Given** `getUser()` is called with a non-existent userId
**When** the test runs
**Then** `NotFoundException` is thrown

**Dev Notes:**
- Mock `UserRepository`, `PrismaService`
- Cover: success paths, not-found, forbidden (self vs other), role-specific branches

---

### Story 16.3: Notification, Cache, and Storage service tests

As a **developer**,
I want `NotificationsService`, `CacheService`, and `StorageService` covered by unit tests,
So that infrastructure services have a safety net against regressions.

**Source:** NFR-9 (Medium) — Audit missing test coverage

**Acceptance Criteria:**

**Given** unit tests exist for each service
**When** `npx jest --coverage` runs on each service file
**Then** each shows ≥ 80% branch coverage

**Given** `CacheService.getOrSet(key, factory, ttl)` is called with a cache miss
**When** the test runs
**Then** `factory()` is called, the result is stored, and the value is returned

**Given** `CacheService.getOrSet(key, factory, ttl)` is called with a cache hit
**When** the test runs
**Then** `factory()` is NOT called and the cached value is returned

**Given** `StorageService.uploadBuffer()` is called and the S3 client throws `NoSuchBucketError`
**When** the test runs
**Then** the error is re-thrown as `InternalServerErrorException`

**Given** `NotificationsService.sendEmail()` is called
**When** the test runs
**Then** an email job is enqueued via the mocked `EmailQueueService`

**Dev Notes:**
- Mock `ioredis` for CacheService (`jest.mock('ioredis', ...)`)
- Mock `@aws-sdk/client-s3` for StorageService
- Mock `BullMQ` queue for NotificationsService (already partially done in `notifications.processor.spec.ts`)

---

### Story 16.4: Eliminate unsafe TypeScript casts

As a **developer**,
I want `as never` and `as any` casts removed from production code,
So that TypeScript's type guarantees apply across the entire codebase.

**Source:** NFR-8 — Audit H4

**Acceptance Criteria:**

**Given** `tenants.service.ts`, `messages.service.ts`, `dashboard.service.ts`, `documents.service.ts` are refactored
**When** `npx tsc --noEmit` runs
**Then** zero cast-related TypeScript errors are reported for those files

**Given** any Prisma query result in those files
**When** assigned to a typed variable
**Then** the type comes from a proper `select` shape, a declared return type, or a Prisma-generated type — not `as any`

**Given** all new code added in EP-10 through EP-15
**When** reviewed
**Then** no `as never` or `as any` casts are introduced

**Dev Notes:**
- Start with `messages.service.ts` (most `as never` occurrences per audit)
- For Prisma results: use `Prisma.UserGetPayload<{ select: typeof USER_SELECT }>` pattern
- For Role/enum comparisons: use string literals (`'ADMIN'`) not namespace (`Role.ADMIN`) — Prisma v7 enums are string literal unions
- NFR-7 (no sensitive data in logs) is enforced by Story 10.1; this story covers type safety only

---

### Story 16.5: Integration test flows

As a **developer**,
I want end-to-end integration tests covering core business flows,
So that cross-module regressions are detected before they reach production.

**Source:** NFR-9 — Audit missing integration test flows

**Acceptance Criteria:**

**Given** a real test database (PostgreSQL via Docker or test container)
**When** the full `Register → verify OTP → login → update profile` flow runs end-to-end
**Then** each step returns the expected HTTP status and response shape

**Given** the same test database
**When** the `Create contract → register payment → commission auto-generated → download receipt URL` flow runs
**Then** each step succeeds: contract created, payment PAID, MANAGEMENT commission created, signed R2 URL returned (mocked R2)

**Given** the same test database
**When** the `Submit public application (with valid Turnstile mock) → application status PENDING` flow runs
**Then** the Application record exists in DB with status PENDING

**Given** the integration tests run in CI (GitHub Actions or equivalent)
**When** `npm run test:e2e` is executed
**Then** all three flows pass without real Redis or real R2 (both mocked in test env)

**Dev Notes:**
- Use `@nestjs/testing` `TestingModule` with real Prisma against a test DB
- Mock `EmailQueueService` (no real BullMQ in tests) — see existing `notifications.processor.spec.ts` pattern
- Mock `StorageService.uploadBuffer()` → returns `"https://mock-r2.test/{key}"`
- Mock Turnstile guard in E2E tests (`TurnstileGuard` returns `true` when `TURNSTILE_DISABLE_IN_TESTS=true`)
- Add `TURNSTILE_DISABLE_IN_TESTS=true` to `.env.test`
