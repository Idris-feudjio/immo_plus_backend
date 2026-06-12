---
stepsCompleted: [1]
inputDocuments:
  - "_bmad-output/planning-artifacts/prds/prd-immo-plus-backend-2026-06-12/prd.md"
  - "_bmad-output/planning-artifacts/architecture.md"
  - "_bmad-output/project-context.md"
---

# Immo Plus CM Backend - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for **immo-plus-backend**, decomposing the requirements from the PRD (38 FRs, all OQs resolved) and Architecture decisions into implementable stories organized by business value and delivery phase.

---

## Requirements Inventory

### Functional Requirements

FR-1: Un Visiteur peut créer un compte (prénom, nom, email, téléphone optionnel, mot de passe, rôle). Le système envoie un OTP 6 chiffres valide 15 min. Max 3 tentatives/10 min.
FR-2: Un Utilisateur peut se connecter (email + mdp) et reçoit un access token (15 min) + refresh token UUID (30 jours, rotation à chaque usage).
FR-3: Un Utilisateur peut demander la réinitialisation de son mot de passe par email (token 1h, réponse anti-enumeration).
FR-4: Un Utilisateur authentifié peut modifier son profil (nom, téléphone, avatar R2) et changer son mot de passe (bcrypt salt=12).
FR-5: Un Owner/Admin peut créer un bien (titre, type, ville, quartier, adresse, prix FCFA, surface, chambres, salles de bain, description). Slug auto-généré = `{titre}-{uuid8}`. Status initial = AVAILABLE, isPublished = false.
FR-6: Un Owner/Admin peut publier ou dépublier un bien. Publication impossible sans au moins 1 image.
FR-7: Un Owner peut ajouter jusqu'à 4 images (max) et des documents à un bien. 1ère image = cover auto. Suppression cover transfère au suivant. Upload sur R2, resize via `sharp`.
FR-8: Un Owner/Admin peut modifier le statut d'un bien (AVAILABLE, MAINTENANCE, RESERVED). RENTED = automatique via contrat. Suppression = soft-delete, bloquée si contrat ACTIVE.
FR-9: Listing et recherche des biens selon le rôle (ADMIN:tous, OWNER:ses biens, MANAGER:biens mandatés). Filtres: ville, quartier, type, statut, chambres, prix, surface. Pagination 0-based, max 100.
FR-10: Un Owner peut créer un profil Tenant (nom, prénom, email, téléphone, pièce d'identité, profession, revenu). Liaison optionnelle à un User existant (userId unique).
FR-11: Un Owner/Admin peut consulter le dossier complet d'un Tenant: infos + contrats + historique paiements.
FR-12: Un Owner peut lister et rechercher ses Tenants (nom, email, numéro d'identité).
FR-13: Un Owner/Manager peut créer un Contrat actif (propertyId, tenantId, dates, loyer FCFA, frais, dépôt, clauses). Transaction atomique: contrat + RENTED + échéancier (dueDate=5 du mois) + notification tenant.
FR-14: Un Owner/Manager peut lister et consulter ses contrats avec filtres (statut, propriété, locataire).
FR-15: Un Owner/Manager peut renouveler un contrat ACTIVE/EXPIRED. Nouveau contrat ACTIVE + parentContractId + ancien passe en RENEWAL + nouvel échéancier.
FR-16: Un Owner/Manager peut résilier un contrat ACTIVE (date résiliation). Transaction: TERMINATED + paiements PENDING annulés + bien AVAILABLE + notification tenant.
FR-17: Un Owner peut générer le PDF d'un contrat (synchrone <3s), uploadé sur R2. Mentions obligatoires: bailleur, locataire, adresse, période, loyer HT, TVA 19.25%, TTC, dépôt, clauses.
FR-18: Un Owner/Manager peut marquer un Payment PENDING/LATE comme PAID (méthode, référence, date). Quittance PDF synchrone générée et uploadée R2. Notification email + PDF au tenant. Si Mandat actif avec commission → Commission MANAGEMENT créée dans la même transaction.
FR-19: Cron job quotidien 00h01 passe en LATE tous les Payments PENDING dont dueDate < now().
FR-20: Alertes email envoyées avant/après échéance selon PaymentAlertConfig de l'Owner. Défaut: J-5, J+1, J+3, J+7. Max 3 relances/mois/locataire. Désactivable.
FR-21: Un Owner peut consulter l'historique complet des paiements avec filtres (statut, propriété, locataire, période).
FR-22: Un Tenant (sur son bien loué) ou Owner peut créer une demande de maintenance (titre, description, urgence LOW/NORMAL/HIGH/CRITICAL, photos optionnelles R2). Notification Owner immédiate. CRITICAL = notification prioritaire.
FR-23: Un Owner/Manager peut faire progresser le statut OPEN→IN_PROGRESS→RESOLVED. Un Tenant peut clôturer (RESOLVED→CLOSED) ou rouvrir (RESOLVED→OPEN). Notification Tenant à chaque transition.
FR-24: Un Owner peut lister les demandes de maintenance avec filtres (statut, urgence, bien).
FR-25: Un Admin peut créer une Agence (nom, email, téléphone, adresse, RCCM optionnel). Status initial ACTIVE. Activation immédiate sans KYC. Seul l'Admin peut suspendre.
FR-26: Un Admin/responsable Agence peut affecter un User MANAGER à une Agence. Un Manager = une seule Agence. Crée une entrée AgencyMember (role: MEMBER|ADMIN).
FR-27: Un Owner peut créer un Mandat de gestion (propertyId, agencyId, managerId, dates, commissionType optionnel, commissionValue). Non exclusif: plusieurs Mandats ACTIVE simultanés sur un bien autorisés. Manager mandaté acquiert droits de gestion sur le bien.
FR-28: Un Visiteur peut consulter le profil public d'une Agence (nom, biens gérés publiés, contact).
FR-29: Un Manager peut créer manuellement une Commission (type PLACEMENT ou EXCEPTIONAL, contractId, montantHT FCFA, description). TVA 19.25% calculée auto. Notification Owner. Commission immuable après PAID.
FR-30: Un Owner peut marquer une Commission PENDING comme PAID (méthode, référence). Reçu PDF commission synchrone généré R2. Notification Manager. Commission immuable après PAID.
FR-31: Un Manager/Admin peut consulter le tableau de bord des commissions (encaissées, en attente, par agence, par type, par période). Calcul CA mensuel HT+TVA+TTC.
FR-32: Un Owner/Manager peut consulter les KPIs de portefeuille en temps réel: biens par statut, taux d'occupation, revenus locatifs du mois, paiements LATE, contrats expirant dans 30 jours. Cache Redis TTL 5 min.
FR-33: Un Owner/Manager peut voir: nombre de maintenances ouvertes par urgence, délai moyen de résolution (30 derniers jours).
FR-34: Un Manager peut voir les KPIs commissions: encaissées du mois, en attente, top 5 propriétaires par volume.
FR-35: Un Admin peut voir les KPIs plateforme: utilisateurs actifs par rôle, biens/contrats actifs/LATE, revenu mensuel plateforme, agences les plus actives.
FR-36: Un Visiteur peut soumettre une Candidature sur un Bien publié (nom, prénom, email, téléphone, message optionnel). Sans authentification. Application créée PENDING. Notification Owner/Manager in-app + email.
FR-37: Un Mandat porte les paramètres de commission MANAGEMENT (commissionType: PERCENTAGE|FIXED, commissionValue). Déclenchent auto-génération Commission à chaque Payment PAID.
FR-38: Lors du passage Payment→PAID, si Mandat actif avec commissionType sur le bien: Commission MANAGEMENT créée dans la même transaction atomique. Calcul HT selon type + TVA 19.25% snapshot. Notification Owner. Si plusieurs Mandats actifs → une Commission par Mandat.

### NonFunctional Requirements

NFR-1 (Performance): Latence API p95 < 300ms pour les endpoints GET.
NFR-2 (Performance): Latence API p95 < 800ms pour les endpoints POST/PATCH.
NFR-3 (Performance): Latence API p95 < 3s pour la génération PDF synchrone.
NFR-4 (Performance): Rate limiting global: 200 requêtes/60s/IP via ThrottlerGuard.
NFR-5 (Disponibilité): SLA cible MVP: 99.5%/mois.
NFR-6 (Sécurité): Tous les endpoints protégés par JwtAuthGuard global. Routes publiques via @Public().
NFR-7 (Sécurité): Mots de passe hachés bcrypt salt=12. Jamais stockés ni retournés en clair.
NFR-8 (Sécurité): Refresh token rotation — chaque refresh révoque l'ancien et génère un nouveau UUID.
NFR-9 (Sécurité): File uploads: validation MIME type + taille max avant envoi R2.
NFR-10 (Sécurité): CORS restreint aux origines: immoplus.cm, www.immoplus.cm, localhost:5173, localhost:3001.
NFR-11 (Qualité): DTOs validés strictement (class-validator, whitelist:true, forbidNonWhitelisted:true).
NFR-12 (Qualité): Toutes les réponses enveloppées dans {data, statusCode, timestamp} via TransformInterceptor.
NFR-13 (Qualité): Toutes les erreurs retournent {statusCode, error, message, details?, path, timestamp} via GlobalExceptionFilter.
NFR-14 (Qualité): Opérations multi-tables atomiques via UnitOfWorkService (Prisma $transaction).
NFR-15 (Scalabilité): Architecture stateless, scalable horizontalement. Cache Redis partagé entre instances.
NFR-16 (Scalabilité): Emails envoyés via BullMQ (worker découplé, 3 tentatives, backoff exponentiel).
NFR-17 (Observabilité): LoggingInterceptor: toutes les requêtes HTTP loggées (méthode, path, durée, statut).
NFR-18 (Observabilité): Cron jobs loggent le nombre d'entités traitées après chaque exécution.
NFR-19 (i18n): Messages d'erreur et notifications en français (marché camerounais).
NFR-20 (i18n): Format monétaire: toLocaleString('fr-FR') + ' FCFA'.
NFR-21 (i18n): Format de date: date-fns avec locale fr.
NFR-22 (Légal): Conservation des données contractuelles documentée: 10 ans (droit camerounais). Mécanisme d'archivage automatique différé en v2.

### Additional Requirements (Architecture)

- ARCH-1: PrismaModule global utilisant PrismaPg adapter (jamais PrismaClient direct). passwordHash exclu de tous les select.
- ARCH-2: EventEmitter2 global configuré avec wildcard:true, delimiter:'.', maxListeners:20 pour les Domain Events in-process.
- ARCH-3: Prisma migrations dans l'ordre strict: M1 (Agency+AgencyMember+enums) → M2 (Mandate) → M3 (Commission) → M4 (index de performance).
- ARCH-4: Tout nouveau repository hérite de BaseRepository<PrismaDelegate, Domain>. QueryField[] définis pour la recherche.
- ARCH-5: MandateGuard nouveau guard: vérifie Mandate ACTIVE du Manager sur le propertyId de la requête.
- ARCH-6: DomainEvent base class dans src/common/events/domain-event.base.ts (occurredAt, eventId).
- ARCH-7: PdfService synchrone dans src/common/services/ avec generateContractPdf, generateReceiptPdf, generateCommissionReceiptPdf.
- ARCH-8: Redis cache: 5 patterns de clés + TTLs. Invalidation événementielle via Domain Events.
- ARCH-9: Clean Architecture folder structure: domain/ + application/ + infrastructure/ + presentation/ par module pour les nouveaux modules.
- ARCH-10: Soft-delete via deletedAt sur Property et Mandate. Jamais de hard-delete direct.

### UX Design Requirements

Aucun document UX Design disponible pour ce projet (backend uniquement).

### FR Coverage Map

| FR | Epic assigné |
|----|-------------|
| FR-1 à FR-4 | EP-1 (Auth & Users) |
| FR-5 à FR-9, FR-36 | EP-2 (Property Management) |
| FR-10 à FR-12 | EP-3 (Tenant Management) |
| FR-13 à FR-17 | EP-4 (Lease Management) |
| FR-18 à FR-21 | EP-5 (Payment Management) |
| FR-22 à FR-24 | EP-6 (Maintenance) |
| FR-25 à FR-28, FR-37 | EP-7 (Agency & Mandate) |
| FR-29 à FR-31, FR-38 | EP-8 (Commission) |
| FR-32 à FR-35 | EP-9 (Dashboard & Analytics) |
| NFR-1 à NFR-22, ARCH-1 à ARCH-10 | EP-0 (Infrastructure & Cross-cutting) |

---

## Epic List

| # | Epic | Phase PRD | Priorité | Points estimés |
|---|------|-----------|----------|---------------|
| EP-0 | Infrastructure & Cross-cutting Concerns | Phase 1 (M0) | CRITICAL | 21 |
| EP-1 | Auth & User Management | Phase 1 (M0→M1) | CRITICAL | 34 |
| EP-2 | Property Management | Phase 1 (M1→M2) | HIGH | 55 |
| EP-3 | Tenant Management | Phase 1 (M1→M2) | HIGH | 21 |
| EP-4 | Lease Management | Phase 1 (M1→M2) | HIGH | 55 |
| EP-5 | Payment Management | Phase 1 (M1→M2) | HIGH | 34 |
| EP-6 | Maintenance Management | Phase 1 (M2) | MEDIUM | 21 |
| EP-7 | Agency & Mandate Management | Phase 2 (M2→M4) | HIGH | 55 |
| EP-8 | Commission Management | Phase 2 (M3→M4) | HIGH | 34 |
| EP-9 | Dashboard & Analytics | Phase 3 (M4→M6) | MEDIUM | 34 |

**Total estimé : 364 points (Story Points, échelle Fibonacci)**

---

## Ordre d'implémentation recommandé

```
Sprint 1-2  │ EP-0  Infrastructure
Sprint 2-4  │ EP-1  Auth & Users
Sprint 4-6  │ EP-2  Properties + EP-3 Tenants (parallélisables)
Sprint 6-9  │ EP-4  Lease + EP-5 Payments (séquentiels — EP-4 → EP-5)
Sprint 9-10 │ EP-6  Maintenance
Sprint 10-13│ EP-7  Agency & Mandate (bloque EP-8)
Sprint 13-15│ EP-8  Commission (dépend EP-7 + EP-5)
Sprint 15-17│ EP-9  Dashboard (dépend tous les modules)
```

---

## Dépendances inter-Epics

```
EP-0 ──────────────────────────────► tous les epics (bloquant)
EP-1 (Auth) ───────────────────────► EP-2, EP-3, EP-4, EP-5, EP-6, EP-7, EP-8, EP-9
EP-2 (Property) ───────────────────► EP-3, EP-4, EP-6, EP-7
EP-3 (Tenant) ─────────────────────► EP-4
EP-4 (Lease) ──────────────────────► EP-5, EP-8
EP-5 (Payment) ────────────────────► EP-8 (auto-commission)
EP-7 (Agency & Mandate) ───────────► EP-8 (commission params)
EP-2+EP-4+EP-5+EP-6+EP-7+EP-8 ────► EP-9 (dashboard agrège tout)
```

---

## Epic 0: Infrastructure & Cross-cutting Concerns

**Goal:** Mettre en place toutes les fondations techniques requises par les autres Epics. Sans cette base, aucun autre epic ne peut démarrer.

**Stories :** 7 stories | ~21 points

### Story 0.1: Configuration PrismaModule avec PrismaPg adapter

As a **developer**,
I want the PrismaModule to use the PrismaPg adapter (never raw PrismaClient),
So that all database operations use the connection pooling adapter as required by the architecture.

**Acceptance Criteria:**

**Given** the project uses `@prisma/adapter-pg` and `pg` Pool
**When** PrismaService initializes
**Then** a PrismaPg adapter is constructed with `pg.Pool({ connectionString: process.env.DATABASE_URL })`
**And** `new PrismaClient({ adapter })` is used — never `new PrismaClient()` without adapter
**And** PrismaService is declared `@Global()` and exported from PrismaModule

**Given** any controller or service needs database access
**When** it injects PrismaService
**Then** it receives the adapter-backed instance with no additional configuration needed

**Estimé :** 3 points | **Labels :** `infrastructure`, `database`, `phase-1`

---

### Story 0.2: EventEmitter2 global pour Domain Events

As a **developer**,
I want EventEmitter2 configured globally in AppModule,
So that Domain Events can be emitted and subscribed to across all modules without circular dependencies.

**Acceptance Criteria:**

**Given** AppModule imports EventEmitterModule
**When** the application bootstraps
**Then** `EventEmitterModule.forRoot({ wildcard: true, delimiter: '.', maxListeners: 20, verboseMemoryLeak: true })` is configured
**And** any service can inject `EventEmitter2` and emit events using dot notation (e.g., `'payment.registered'`)
**And** any handler annotated with `@OnEvent('payment.registered')` receives the event

**Given** an event handler receives a domain event
**When** it processes the event
**Then** it must NOT emit further events (no chained events rule enforced by convention)

**Estimé :** 2 points | **Labels :** `infrastructure`, `events`, `phase-1`

---

### Story 0.3: DomainEvent base class et PdfService

As a **developer**,
I want a shared DomainEvent base class and a PdfService,
So that all domain events have a consistent structure and PDF generation is centralized.

**Acceptance Criteria:**

**Given** `src/common/events/domain-event.base.ts` exists
**When** a new Domain Event class extends it
**Then** it inherits `occurredAt: Date` (set to `new Date()`) and `eventId: string` (set to `uuidv4()`)
**And** it declares an abstract `eventName: string`

**Given** `src/common/services/pdf.service.ts` exists
**When** called with a contract/payment/commission view model
**Then** it returns a `Buffer` (synchronous, < 3s)
**And** methods exposed: `generateContractPdf`, `generateReceiptPdf`, `generateCommissionReceiptPdf`

**Estimé :** 3 points | **Labels :** `infrastructure`, `pdf`, `phase-1`

---

### Story 0.4: TransformInterceptor et GlobalExceptionFilter (vérification)

As a **developer**,
I want to verify that TransformInterceptor and GlobalExceptionFilter are wired globally,
So that all responses and errors follow the canonical envelope formats.

**Acceptance Criteria:**

**Given** any successful API response
**When** the response is returned
**Then** it is wrapped as `{ data: <payload>, statusCode: <http_code>, timestamp: <ISO_string> }`

**Given** any thrown NestJS exception (BadRequestException, NotFoundException, etc.)
**When** the exception propagates to the filter
**Then** it returns `{ statusCode, error, message, details?, path, timestamp }`
**And** `passwordHash` NEVER appears in any response payload (enforced via Prisma select exclusion)

**Estimé :** 2 points | **Labels :** `infrastructure`, `cross-cutting`, `phase-1`

---

### Story 0.5: BullMQ configuration pour notifications email

As a **developer**,
I want a BullMQ `notifications` queue configured,
So that email notifications can be sent asynchronously with retry logic.

**Acceptance Criteria:**

**Given** `@nestjs/bullmq` is configured in AppModule with Redis connection
**When** an event handler enqueues a `send-email` job
**Then** the job payload includes `{ to, subject, template, data }`
**And** the job is configured with `{ attempts: 3, backoff: { type: 'exponential', delay: 5000 } }`
**And** a `NotificationsProcessor` worker processes `send-email` jobs and sends email via the configured email provider

**Estimé :** 5 points | **Labels :** `infrastructure`, `queue`, `email`, `phase-1`

---

### Story 0.6: Redis CacheService global

As a **developer**,
I want a global CacheService wrapping ioredis,
So that all modules can cache and invalidate data using the canonical key patterns.

**Acceptance Criteria:**

**Given** CacheService is provided globally
**When** a module calls `cache.get<T>(key)`, `cache.set(key, value, ttlSeconds)`, `cache.del(key)`
**Then** it operates against the configured Redis instance via ioredis `^5.11.0`
**And** keys follow the convention: `{module}:{id}:{type}` (e.g., `dashboard:{userId}:metrics`)
**And** `cache.set` without TTL is forbidden — always requires explicit TTL

**Estimé :** 3 points | **Labels :** `infrastructure`, `cache`, `redis`, `phase-1`

---

### Story 0.7: Prisma Migrations Phase 2 (Agency → Mandate → Commission)

As a **developer**,
I want the Prisma schema updated with Agency, AgencyMember, Mandate, Commission models and run migrations in the correct order,
So that Phase 2 features have the required database structure before any Agency/Mandate/Commission code is written.

**Acceptance Criteria:**

**Given** the current schema has no Agency/AgencyMember/Mandate/Commission tables
**When** migrations are run in order
**Then**:
- M1 `add_agency_with_enums`: creates `agencies`, `agency_members` tables + enums `AgencyStatus`, `AgencyMemberRole`
- M2 `add_mandate`: creates `mandates` table + enums `MandateStatus`, `CommissionType` + adds `User.managedMandates`, `Property.mandates`
- M3 `add_commission`: creates `commissions` table + enums `CommissionCategory`, `CommissionStatus` + adds `Contract.commissions`
- M4 `add_performance_indexes`: adds composite indexes on `mandates(propertyId,status)`, `mandates(agencyId,status)`, `commissions(agencyId,status)`
**And** `npx prisma generate` succeeds after each migration
**And** all new models follow `@@map("snake_case")` and use `@id @default(uuid())`

**Estimé :** 3 points | **Labels :** `infrastructure`, `database`, `migration`, `phase-2`

---

## Epic 1: Auth & User Management

**Goal:** Permettre à tous les types d'utilisateurs de créer un compte, se connecter, gérer leur session et leur profil. Bloque tous les autres Epics.

**Covers:** FR-1, FR-2, FR-3, FR-4
**Stories :** 8 stories | ~34 points

### Story 1.1: Inscription avec vérification OTP email

As a **Visitor**,
I want to register with my email and receive an OTP to verify my account,
So that I can access the platform with a verified identity.

**Acceptance Criteria:**

**Given** a POST to `/api/auth/register` with valid payload (firstName, lastName, email, password, role)
**When** the request is processed
**Then** a User is created with `emailVerified: false`, `isActive: true`
**And** an OTP (6 digits) is generated, stored hashed, expires in 15 minutes
**And** an email is sent to the provided address with the OTP via BullMQ queue
**And** the response returns HTTP 201 with `{ userId, email }` (no passwordHash)

**Given** email already exists in the database
**When** registration is attempted
**Then** HTTP 409 is returned with error code `EMAIL_ALREADY_EXISTS`

**Given** an OTP is submitted via POST `/api/auth/verify-otp`
**When** the OTP is valid and not expired
**Then** `emailVerified` is set to `true` and HTTP 200 is returned

**Given** 3 failed OTP attempts within 10 minutes
**When** a 4th attempt is made
**Then** HTTP 429 is returned with `OTP_RATE_LIMIT` error

**Estimé :** 5 points | **Labels :** `auth`, `phase-1` | **Dépend de :** Story 0.1, 0.5

---

### Story 1.2: Connexion JWT + rotation refresh token

As an **authenticated User**,
I want to log in with email/password and receive JWT + refresh tokens,
So that I can access protected resources with automatic session renewal.

**Acceptance Criteria:**

**Given** a POST to `/api/auth/login` with valid credentials
**When** the credentials are valid and email is verified
**Then** HTTP 200 returns `{ accessToken (15min JWT), refreshToken (UUID 30 days) }`
**And** the refresh token is stored in the database (hashed or raw UUID)

**Given** email not verified
**When** login is attempted
**Then** HTTP 401 with `EMAIL_NOT_VERIFIED`

**Given** a valid refresh token submitted to POST `/api/auth/refresh`
**When** the token exists and is not expired
**Then** the old refresh token is revoked (deleted) and a new pair is returned
**And** the old token cannot be reused (rotation enforced)

**Given** a POST to `/api/auth/logout`
**When** the request is authenticated
**Then** the current refresh token is revoked and HTTP 200 returned

**Estimé :** 5 points | **Labels :** `auth`, `phase-1` | **Dépend de :** Story 0.1

---

### Story 1.3: Réinitialisation du mot de passe (anti-enumeration)

As a **User who forgot their password**,
I want to request a password reset via email,
So that I can regain access to my account without exposing whether an email exists.

**Acceptance Criteria:**

**Given** a POST to `/api/auth/forgot-password` with any email
**When** the request is processed
**Then** HTTP 200 is ALWAYS returned regardless of whether the email exists (anti-enumeration)
**And** if the email exists, a reset token (UUID, 1h expiry) is sent by email

**Given** a valid reset token submitted to POST `/api/auth/reset-password`
**When** the token is valid and not expired
**Then** the password is updated (bcrypt salt=12) and the token is consumed (cannot be reused)

**Given** an expired or already-used token
**When** submitted
**Then** HTTP 400 is returned

**Estimé :** 3 points | **Labels :** `auth`, `phase-1`

---

### Story 1.4: Gestion du profil utilisateur

As an **authenticated User**,
I want to view and update my profile information,
So that my contact details and avatar are always current.

**Acceptance Criteria:**

**Given** a GET to `/api/users/me`
**When** the user is authenticated
**Then** HTTP 200 returns user profile (id, firstName, lastName, email, phone, role, avatarUrl, emailVerified) without passwordHash

**Given** a PATCH to `/api/users/me` with updated fields
**When** the request is valid
**Then** firstName, lastName, phone are updated and HTTP 200 returned with updated profile

**Given** a POST to `/api/users/me/avatar` with a file upload
**When** the file is a valid image (MIME type validated)
**Then** the file is uploaded to R2 at key `users/{userId}/avatar.{ext}`
**And** `avatarUrl` is updated in the database

**Given** a PATCH to `/api/users/me/password` with currentPassword and newPassword
**When** currentPassword matches the stored bcrypt hash
**Then** the password is updated with bcrypt salt=12 and HTTP 200 returned

**Estimé :** 5 points | **Labels :** `users`, `phase-1`

---

### Story 1.5: Guards globaux — JwtAuthGuard + RolesGuard

As a **developer**,
I want JwtAuthGuard and RolesGuard wired as global guards,
So that all endpoints are protected by default and role-based access is declarative.

**Acceptance Criteria:**

**Given** JwtAuthGuard is registered as a global guard in AppModule
**When** a request arrives without a valid Bearer token
**Then** HTTP 401 is returned — UNLESS the route is decorated with `@Public()`

**Given** a route decorated with `@Roles(Role.OWNER, Role.ADMIN)`
**When** a MANAGER attempts to access it
**Then** HTTP 403 is returned

**Given** a route decorated with `@Public()`
**When** any request arrives (authenticated or not)
**Then** the JWT check is skipped and the handler is invoked

**Estimé :** 3 points | **Labels :** `auth`, `security`, `phase-1`

---

### Story 1.6: MandateGuard pour accès Manager mandaté

As a **developer**,
I want a MandateGuard that verifies a Manager has an active Mandate on the requested property,
So that manager access to property resources is governed by mandates, not a static managerId field.

**Acceptance Criteria:**

**Given** a route protected with `@UseGuards(MandateGuard)`
**When** an OWNER or ADMIN makes a request
**Then** the guard passes through (non-Manager roles bypass the mandate check)

**Given** a MANAGER makes a request to a property-scoped route
**When** the Manager has no active Mandate on the propertyId
**Then** HTTP 403 is returned with `NO_ACTIVE_MANDATE`

**Given** a MANAGER with an active Mandate on the property
**When** the request is made
**Then** the guard passes and the handler is invoked

**Given** the `propertyId` comes from either `params.propertyId` or `body.propertyId`
**When** the guard evaluates
**Then** it correctly resolves the propertyId from both sources

**Estimé :** 5 points | **Labels :** `auth`, `security`, `mandate`, `phase-2` | **Dépend de :** Story 7.2

---

### Story 1.7: Admin — Listing et gestion des utilisateurs

As an **Admin**,
I want to list, search, and manage all users on the platform,
So that I can supervise accounts and resolve issues.

**Acceptance Criteria:**

**Given** a GET to `/api/admin/users` with pagination and optional filters (role, isActive, search)
**When** authenticated as ADMIN
**Then** a paginated list of users is returned (excluding passwordHash)

**Given** a PATCH to `/api/admin/users/:id/deactivate`
**When** authenticated as ADMIN
**Then** the user's `isActive` is set to false and HTTP 200 returned

**Estimé :** 5 points | **Labels :** `admin`, `users`, `phase-1`

---

### Story 1.8: ThrottlerGuard et CORS configuration

As a **system operator**,
I want rate limiting and CORS configured,
So that the API is protected from abuse and only accessible from allowed origins.

**Acceptance Criteria:**

**Given** ThrottlerModule is configured globally
**When** an IP sends more than 200 requests in 60 seconds
**Then** HTTP 429 is returned for subsequent requests

**Given** a request arrives from `immoplus.cm`, `www.immoplus.cm`, `localhost:5173`, or `localhost:3001`
**When** CORS is evaluated
**Then** the request is allowed

**Given** a request arrives from any other origin
**When** CORS is evaluated
**Then** the request is rejected

**Estimé :** 3 points | **Labels :** `security`, `phase-1`

---

## Epic 2: Property Management

**Goal:** Permettre aux Owners de créer, gérer, publier leurs biens et aux Visiteurs de les consulter. Inclut les candidatures publiques.

**Covers:** FR-5, FR-6, FR-7, FR-8, FR-9, FR-36
**Stories :** 10 stories | ~55 points

### Story 2.1: Création d'un bien immobilier

As an **Owner**,
I want to create a property listing with all required details,
So that I can manage my real estate portfolio on the platform.

**Acceptance Criteria:**

**Given** a POST to `/api/properties` with title, type, city, neighborhood, address, price, surface, and optional rooms/bathrooms/description
**When** authenticated as OWNER or ADMIN
**Then** a Property is created with status=AVAILABLE, isPublished=false
**And** slug is auto-generated as `{slugified-title}-{uuid.slice(0,8)}`
**And** `priceLabel` is auto-set as `"{price.toLocaleString('fr-FR')} FCFA/mois"`
**And** HTTP 201 returns the created property (without softDeleted properties)

**Given** a title that produces a duplicate slug
**When** the property is created
**Then** the uuid8 suffix ensures uniqueness

**Estimé :** 5 points | **Labels :** `property`, `phase-1` | **Dépend de :** Story 0.1, 1.5

---

### Story 2.2: Gestion des images (max 4, cover auto)

As an **Owner**,
I want to upload up to 4 images per property with automatic cover management,
So that my listing is visually complete and publication-ready.

**Acceptance Criteria:**

**Given** a POST to `/api/properties/:id/images` with 1–4 image files
**When** the property already has fewer than 4 images
**Then** images are uploaded to R2 at `properties/{propertyId}/images/{imageId}.{ext}`, resized via sharp
**And** the first uploaded image becomes the cover if none exists (`isCover=true`)
**And** HTTP 201 returns the list of images

**Given** a property already has 4 images
**When** another image upload is attempted
**Then** HTTP 409 is returned with `MAX_IMAGES_REACHED`

**Given** a DELETE to `/api/properties/:id/images/:imageId` for the cover image
**When** other images exist
**Then** the next image in order becomes the new cover automatically

**Given** a PATCH to `/api/properties/:id/images/:imageId/cover`
**When** authenticated as the Owner
**Then** the selected image becomes the cover and the previous cover is unset

**Estimé :** 8 points | **Labels :** `property`, `storage`, `phase-1` | **Dépend de :** Story 2.1

---

### Story 2.3: Publication et dépublication d'un bien

As an **Owner**,
I want to publish and unpublish my property,
So that it appears on or disappears from the public portal.

**Acceptance Criteria:**

**Given** a PATCH to `/api/properties/:id/publish` with `{ isPublished: true }`
**When** the property has at least 1 image
**Then** `isPublished` is set to true and HTTP 200 returned
**And** the property is now visible at the public endpoint `GET /api/properties` (with no auth)

**Given** a property with 0 images
**When** publish is attempted
**Then** HTTP 409 returned with message `"Le bien doit avoir au moins 1 image pour être publié."`

**Given** a PATCH to `/api/properties/:id/publish` with `{ isPublished: false }`
**When** authenticated as Owner or Admin
**Then** `isPublished` is set to false and the property no longer appears in the public listing

**Estimé :** 3 points | **Labels :** `property`, `phase-1` | **Dépend de :** Story 2.2

---

### Story 2.4: Gestion du statut et soft-delete

As an **Owner**,
I want to update my property status and soft-delete properties I no longer manage,
So that my portfolio accurately reflects the real-world state of each property.

**Acceptance Criteria:**

**Given** a PATCH to `/api/properties/:id/status` with `{ status: 'MAINTENANCE' | 'RESERVED' | 'AVAILABLE' }`
**When** authenticated as Owner (own property) or Admin
**Then** the status is updated and HTTP 200 returned

**Given** a non-Admin user attempts to set status to RENTED manually
**When** the request is processed
**Then** HTTP 403 is returned

**Given** a DELETE to `/api/properties/:id`
**When** the property has no active contract (status != RENTED)
**Then** `deletedAt` is set to now() (soft-delete) and HTTP 204 returned

**Given** a DELETE attempt on a property with an active contract
**When** the request is processed
**Then** HTTP 409 returned with `PROPERTY_HAS_ACTIVE_CONTRACT`

**Estimé :** 5 points | **Labels :** `property`, `phase-1`

---

### Story 2.5: Listing public des biens (portail visiteur)

As a **Visitor**,
I want to browse published properties without logging in,
So that I can find a home before creating an account.

**Acceptance Criteria:**

**Given** a GET to `/api/properties` (public, no auth required — `@Public()`)
**When** called with optional filters (city, type, minPrice, maxPrice, rooms)
**Then** only `isPublished=true` and `deletedAt=null` properties are returned, paginated

**Given** a GET to `/api/properties/:slug` (public)
**When** the slug matches a published property
**Then** HTTP 200 returns property detail with images and documents

**Given** the public listing is requested
**When** the Redis cache key `properties:public:{hash(filters)}` exists (TTL 10 min)
**Then** the cached result is returned without hitting the database

**Given** a `PropertyPublishedEvent` is emitted
**When** the event handler processes it
**Then** the `properties:public:*` cache keys are invalidated

**Estimé :** 8 points | **Labels :** `property`, `cache`, `public`, `phase-1` | **Dépend de :** Story 0.6

---

### Story 2.6: Listing dashboard (Owner/Manager/Admin)

As an **Owner or Manager**,
I want to list and search my managed properties from the dashboard,
So that I can quickly navigate my portfolio.

**Acceptance Criteria:**

**Given** a GET to `/api/properties/dashboard` with optional search and filters
**When** authenticated as OWNER
**Then** only the Owner's properties (ownerId = currentUser.id) are returned, paginated

**When** authenticated as MANAGER
**Then** only properties with an active Mandate for the Manager are returned

**When** authenticated as ADMIN
**Then** all properties are returned

**Given** a search term is provided
**When** the query executes
**Then** it searches across title, description, city, neighborhood (using PROPERTY_QUERY_FIELDS)

**Estimé :** 5 points | **Labels :** `property`, `phase-1`

---

### Story 2.7: Gestion des documents d'un bien

As an **Owner**,
I want to attach documents (lease templates, diagnostics, certificates) to my property,
So that all property-related files are centralized.

**Acceptance Criteria:**

**Given** a POST to `/api/properties/:id/documents` with a file
**When** authenticated as Owner (own property) or Admin
**Then** the document is uploaded to R2 at `properties/{propertyId}/documents/{docId}-{filename}`
**And** a `PropertyDocument` record is created with name, url, createdAt
**And** HTTP 201 returns the document metadata

**Given** a DELETE to `/api/properties/:id/documents/:docId`
**When** authenticated as Owner
**Then** the document is deleted from R2 and the record removed, HTTP 204 returned

**Estimé :** 5 points | **Labels :** `property`, `storage`, `phase-1`

---

### Story 2.8: Candidature locative (portail public)

As a **Visitor**,
I want to submit a rental application on a published property without creating an account,
So that I can express interest in a property immediately.

**Acceptance Criteria:**

**Given** a POST to `/api/applications` (public, `@Public()`) with firstName, lastName, email, phone, propertyId, and optional message
**When** the propertyId refers to a published property
**Then** an `Application` is created with `status=PENDING`
**And** a notification is created in-app for the property Owner/Manager
**And** an email is queued (BullMQ) to the Owner/Manager with the applicant's details
**And** HTTP 201 returns `{ applicationId, status: 'PENDING' }`

**Given** propertyId refers to a non-published or non-existent property
**When** the request is processed
**Then** HTTP 404 is returned

**Estimé :** 5 points | **Labels :** `property`, `application`, `public`, `phase-1`

---

### Story 2.9: Traitement des candidatures (back-office Owner/Manager)

As an **Owner or mandated Manager**,
I want to review and process rental applications,
So that I can accept or reject candidates efficiently.

**Acceptance Criteria:**

**Given** a GET to `/api/applications?propertyId=:id`
**When** authenticated as Owner (own property) or mandated Manager
**Then** applications for the property are returned, filtered by status, paginated

**Given** a PATCH to `/api/applications/:id/accept`
**When** authenticated as Owner or mandated Manager
**Then** `status` is set to ACCEPTED and HTTP 200 returned

**Given** a PATCH to `/api/applications/:id/reject`
**When** authenticated as Owner or mandated Manager
**Then** `status` is set to REJECTED and HTTP 200 returned

**Estimé :** 3 points | **Labels :** `property`, `application`, `phase-1`

---

### Story 2.10: LoggingInterceptor et monitoring API

As a **system operator**,
I want all HTTP requests logged with method, path, duration, and status,
So that I can monitor API performance and debug issues.

**Acceptance Criteria:**

**Given** any HTTP request is processed
**When** the response is returned
**Then** a log entry is written with: `[HTTP] METHOD /path -> STATUS (Xms)`
**And** the log uses NestJS Logger with the module name as context

**Estimé :** 3 points | **Labels :** `observability`, `phase-1`

---

## Epic 3: Tenant Management

**Goal:** Permettre aux Owners de gérer les profils locataires et leur historique.

**Covers:** FR-10, FR-11, FR-12
**Stories :** 4 stories | ~21 points

### Story 3.1: Création d'un profil locataire

As an **Owner**,
I want to create a tenant profile with identity and income information,
So that I have a complete record before creating a lease.

**Acceptance Criteria:**

**Given** a POST to `/api/tenants` with firstName, lastName, email, phone, idNumber, profession, income
**When** authenticated as OWNER or ADMIN
**Then** a Tenant is created linked to the current Owner as creator
**And** if `userId` is provided and a User exists with that ID, the Tenant is linked (optional)
**And** HTTP 201 returns the tenant profile (without any sensitive auth data)

**Given** a userId that already has a Tenant profile
**When** a second Tenant is created with the same userId
**Then** HTTP 409 is returned (userId unique in tenants table)

**Estimé :** 5 points | **Labels :** `tenant`, `phase-1`

---

### Story 3.2: Dossier locataire complet

As an **Owner**,
I want to view a tenant's complete file including their contract and payment history,
So that I can assess their reliability and track their payments.

**Acceptance Criteria:**

**Given** a GET to `/api/tenants/:id`
**When** authenticated as the creating Owner or Admin
**Then** HTTP 200 returns: tenant info + list of all contracts (ACTIVE/EXPIRED/TERMINATED) + payment history per contract

**Given** a different Owner (not the creator) attempts to access the tenant
**When** the request is processed
**Then** HTTP 403 is returned

**Estimé :** 5 points | **Labels :** `tenant`, `phase-1` | **Dépend de :** Story 4.1, 5.1

---

### Story 3.3: Listing et recherche de locataires

As an **Owner**,
I want to list and search my tenants,
So that I can quickly find a tenant profile when needed.

**Acceptance Criteria:**

**Given** a GET to `/api/tenants` with optional search (name, email, idNumber)
**When** authenticated as OWNER
**Then** only the Owner's tenants are returned, paginated (max 100/page, default 20)

**Given** a search term is provided
**When** the query executes
**Then** it searches across firstName, lastName, email, idNumber

**Estimé :** 3 points | **Labels :** `tenant`, `phase-1`

---

### Story 3.4: Mise à jour d'un profil locataire

As an **Owner**,
I want to update a tenant's contact details,
So that the record stays accurate if the tenant changes phone or address.

**Acceptance Criteria:**

**Given** a PATCH to `/api/tenants/:id` with updated fields
**When** authenticated as the creating Owner or Admin
**Then** the specified fields are updated and HTTP 200 returns the updated tenant profile

**And** `ownerId` and `userId` cannot be changed via this endpoint

**Estimé :** 3 points | **Labels :** `tenant`, `phase-1`

---

## Epic 4: Lease Management

**Goal:** Gérer le cycle de vie complet des contrats de location — création, renouvellement, résiliation, génération PDF.

**Covers:** FR-13, FR-14, FR-15, FR-16, FR-17
**Stories :** 7 stories | ~55 points

### Story 4.1: Création d'un contrat (transaction atomique)

As an **Owner or mandated Manager**,
I want to create a rental contract that automatically sets the property to RENTED and generates the payment schedule,
So that the entire lease activation happens in one atomic operation.

**Acceptance Criteria:**

**Given** a POST to `/api/contracts` with propertyId, tenantId, startDate, endDate, rent (FCFA int), fees (FCFA int), deposit, and optional clauses
**When** the property is AVAILABLE or RESERVED and has no ACTIVE contract
**Then** a UnitOfWork transaction executes:
- Contract created with status=ACTIVE
- Property status updated to RENTED
- Payment schedule created: one PENDING Payment per month from startDate to endDate, dueDate = 5th of each month, amount = rent + fees
- In-app notification created for the Tenant
**And** ContractCreatedEvent is emitted
**And** HTTP 201 returns the contract with payment schedule summary

**Given** the property already has an ACTIVE contract
**When** creation is attempted
**Then** HTTP 409 returned with `CONTRACT_ALREADY_ACTIVE`

**Given** the property status is not AVAILABLE or RESERVED
**When** creation is attempted
**Then** HTTP 409 returned with `PROPERTY_NOT_AVAILABLE`

**Estimé :** 13 points | **Labels :** `lease`, `phase-1`, `critical` | **Dépend de :** Story 0.1, 2.1, 3.1

---

### Story 4.2: Consultation et listing des contrats

As an **Owner or Manager**,
I want to view and filter my contracts,
So that I can quickly access the details of any lease.

**Acceptance Criteria:**

**Given** a GET to `/api/contracts` with optional filters (status, propertyId, tenantId)
**When** authenticated as OWNER
**Then** only contracts for the Owner's properties are returned, paginated

**When** authenticated as MANAGER
**Then** only contracts for properties under the Manager's active Mandates are returned

**Given** a GET to `/api/contracts/:id`
**When** authenticated as the Owner or mandated Manager
**Then** HTTP 200 returns contract detail with clauses and payment schedule summary

**Estimé :** 5 points | **Labels :** `lease`, `phase-1`

---

### Story 4.3: Renouvellement d'un contrat

As an **Owner or mandated Manager**,
I want to renew an active or expired contract,
So that the tenancy continues without interruption.

**Acceptance Criteria:**

**Given** a POST to `/api/contracts/:id/renew` with newEndDate and optional updated rent
**When** the contract status is ACTIVE or EXPIRED
**Then** a UnitOfWork transaction executes:
- Old contract status updated to RENEWAL
- New contract created with status=ACTIVE, parentContractId pointing to old contract
- startDate = old endDate + 1 day
- New payment schedule generated
**And** ContractRenewedEvent is emitted
**And** HTTP 201 returns the new contract

**Given** the contract is TERMINATED
**When** renewal is attempted
**Then** HTTP 409 returned with `CONTRACT_NOT_RENEWABLE`

**Estimé :** 8 points | **Labels :** `lease`, `phase-1` | **Dépend de :** Story 4.1

---

### Story 4.4: Résiliation d'un contrat

As an **Owner or mandated Manager**,
I want to terminate a contract with a termination date,
So that the property becomes available again and pending payments are cancelled.

**Acceptance Criteria:**

**Given** a POST to `/api/contracts/:id/terminate` with terminationDate and optional reason
**When** the contract status is ACTIVE
**Then** a UnitOfWork transaction executes:
- Contract status updated to TERMINATED
- All PENDING Payments after terminationDate updated to CANCELLED
- Property status updated to AVAILABLE
- In-app notification created for the Tenant
**And** ContractTerminatedEvent is emitted
**And** HTTP 200 returns the updated contract

**Given** terminationDate is before the contract startDate
**When** the request is processed
**Then** HTTP 400 returned with validation error

**Estimé :** 8 points | **Labels :** `lease`, `phase-1` | **Dépend de :** Story 4.1

---

### Story 4.5: Génération PDF du contrat (synchrone)

As an **Owner**,
I want to download a PDF of my contract on demand,
So that I have a formal document for the tenant to sign.

**Acceptance Criteria:**

**Given** a GET to `/api/contracts/:id/pdf`
**When** no `pdfUrl` exists on the contract
**Then** a PDF is generated synchronously (< 3s) including: bailleur info, locataire info, property address, period, rent HT, TVA 19.25%, rent TTC, deposit, all clauses
**And** the PDF is uploaded to R2 at `contracts/{contractId}/contract.pdf`
**And** `Contract.pdfUrl` is updated
**And** HTTP 200 returns `{ pdfUrl }`

**Given** `pdfUrl` already exists (no force flag)
**When** the endpoint is called
**Then** the existing `pdfUrl` is returned without re-generating

**Given** a GET with `?force=true`
**When** the endpoint is called
**Then** a new PDF is generated, replacing the old one

**Estimé :** 8 points | **Labels :** `lease`, `pdf`, `phase-3` | **Dépend de :** Story 0.3, 4.1

---

### Story 4.6: Cron — Expiration automatique des contrats

As a **system**,
I want a cron job to detect and expire contracts past their end date,
So that property availability is updated automatically without manual intervention.

**Acceptance Criteria:**

**Given** a cron job runs daily at 00:05
**When** contracts exist with endDate < today AND status = ACTIVE
**Then** each contract is processed:
- Contract status updated to EXPIRED
- Property status updated to AVAILABLE
- All remaining PENDING Payments updated to CANCELLED
**And** ContractExpiredEvent is emitted for each contract
**And** the cron logs `"Expired {n} contracts."`

**Estimé :** 5 points | **Labels :** `lease`, `cron`, `phase-1` | **Dépend de :** Story 4.1

---

### Story 4.7: Alertes expiration de bail (J-7, J-15, J-30)

As an **Owner**,
I want to receive email alerts before my lease expires,
So that I have time to renew or find a new tenant.

**Acceptance Criteria:**

**Given** a cron job runs daily at 00:10
**When** contracts exist with endDate in exactly 7, 15, or 30 days AND status = ACTIVE
**Then** an email alert is queued (BullMQ) to the property Owner
**And** the email includes: property address, tenant name, expiry date, link to renew

**And** the cron logs `"Sent {n} lease expiry alerts."`

**Estimé :** 3 points | **Labels :** `lease`, `cron`, `phase-1`

---

## Epic 5: Payment Management

**Goal:** Gérer le cycle de vie des paiements — enregistrement, génération de quittances PDF, automatisation des retards et alertes.

**Covers:** FR-18, FR-19, FR-20, FR-21
**Stories :** 6 stories | ~34 points

### Story 5.1: Enregistrement d'un paiement PAID (transaction critique)

As an **Owner or mandated Manager**,
I want to mark a payment as PAID and automatically generate a receipt,
So that the tenant receives confirmation and the payment is legally documented.

**Acceptance Criteria:**

**Given** a POST to `/api/payments/:id/register` with method (MOBILE_MONEY/TRANSFER/CASH/CARD), reference, and paymentDate
**When** the payment status is PENDING or LATE
**Then** a UnitOfWork transaction executes:
- Payment status updated to PAID
- If active Mandate with commissionType exists on the property → Commission MANAGEMENT created (amountHT calculated, TVA 19.25% snapshot, amountTTC stored as integers)
**And** PaymentRegisteredEvent is emitted
**And** event handlers execute:
- PdfService generates receipt PDF synchronously → uploaded to R2 at `receipts/{contractId}/{paymentId}.pdf`
- Payment.receiptUrl updated
- Tenant notification queued (BullMQ): email with receiptUrl
**And** HTTP 200 returns updated payment with receiptUrl

**Given** the payment is already PAID
**When** registration is attempted
**Then** HTTP 409 returned with `PAYMENT_ALREADY_PAID`

**Estimé :** 13 points | **Labels :** `payment`, `pdf`, `commission`, `phase-1`, `critical` | **Dépend de :** Story 0.1, 0.3, 4.1

---

### Story 5.2: Cron — Automatisation des retards

As a **system**,
I want a cron job to automatically mark overdue payments as LATE,
So that the dashboard reflects actual arrears without manual intervention.

**Acceptance Criteria:**

**Given** a cron job runs daily at 00:01
**When** payments exist with status=PENDING AND dueDate < now()
**Then** all matching payments are updated to status=LATE in a single batch update
**And** the cron logs `"Marked {n} payments as Late."`

**Given** no payments meet the criteria
**When** the cron runs
**Then** nothing is updated and `"Marked 0 payments as Late."` is logged

**Estimé :** 3 points | **Labels :** `payment`, `cron`, `phase-1`

---

### Story 5.3: Alertes de paiement configurables (email)

As an **Owner**,
I want to configure and receive payment alerts before and after due dates,
So that I can proactively follow up with tenants without manual tracking.

**Acceptance Criteria:**

**Given** `PaymentAlertConfig.active = true` for an Owner (default)
**When** a payment's dueDate is exactly 5 days away
**Then** an alert email is queued (BullMQ) to the Owner

**Given** a payment is LATE
**When** daysLate is 1, 3, or 7
**Then** a reminder email is queued to the Owner

**Given** `PaymentAlertConfig.active = false`
**When** any alert condition is triggered
**Then** no email is sent for that Owner's payments

**Given** a tenant has already received 3 alerts this month
**When** a new alert is triggered
**Then** the alert is suppressed (counter-metric SM-C2 — max 3 relances/mois/locataire)

**Estimé :** 8 points | **Labels :** `payment`, `cron`, `email`, `phase-3` | **Dépend de :** Story 0.5

---

### Story 5.4: Historique et reporting des paiements

As an **Owner**,
I want to view the complete payment history with filters,
So that I can track income and identify persistent late payers.

**Acceptance Criteria:**

**Given** a GET to `/api/payments` with filters (status, propertyId, tenantId, contractId, dateFrom, dateTo)
**When** authenticated as OWNER
**Then** only payments for the Owner's contracts are returned, paginated

**Given** a GET to `/api/payments/:id`
**When** authenticated as Owner (own contract) or Admin
**Then** HTTP 200 returns the payment detail with receiptUrl if PAID

**Estimé :** 3 points | **Labels :** `payment`, `phase-1`

---

### Story 5.5: Téléchargement d'une quittance PDF

As a **Tenant**,
I want to download my rent receipt at any time,
So that I have proof of payment when needed.

**Acceptance Criteria:**

**Given** a GET to `/api/payments/:id/receipt`
**When** the payment status is PAID and authenticated as the Tenant (linked contract) or Owner/Admin
**Then** HTTP 200 returns `{ receiptUrl }` (pre-signed URL from R2, 1h expiry)

**Given** the payment is not PAID
**When** the request is made
**Then** HTTP 409 returned with `PAYMENT_NOT_PAID`

**Estimé :** 3 points | **Labels :** `payment`, `storage`, `phase-1`

---

### Story 5.6: Vue paiements locataire (self-service)

As a **Tenant**,
I want to see my payment history and upcoming dues,
So that I can track what I've paid and what's coming up.

**Acceptance Criteria:**

**Given** a GET to `/api/tenants/me/payments`
**When** authenticated as TENANT
**Then** all payments linked to active contracts for this Tenant are returned, sorted by dueDate DESC

**And** PAID payments include receiptUrl
**And** PENDING/LATE payments show dueDate and amount

**Estimé :** 3 points | **Labels :** `payment`, `tenant`, `phase-1`

---

## Epic 6: Maintenance Management

**Goal:** Permettre aux locataires de signaler des problèmes et aux propriétaires de suivre leur résolution.

**Covers:** FR-22, FR-23, FR-24
**Stories :** 5 stories | ~21 points

### Story 6.1: Création d'une demande de maintenance

As a **Tenant or Owner**,
I want to create a maintenance request with urgency level,
So that repair issues are formally tracked and visible to the property owner.

**Acceptance Criteria:**

**Given** a POST to `/api/maintenance` with title, description, urgency (LOW/NORMAL/HIGH/CRITICAL), propertyId, and optional photo URLs
**When** authenticated as TENANT (must have an active contract on the property) or OWNER/ADMIN
**Then** a MaintenanceRequest is created with status=OPEN
**And** MaintenanceCreatedEvent is emitted → in-app notification + email queued to Owner
**And** if urgency=CRITICAL, notification is flagged as priority
**And** HTTP 201 returns the maintenance request

**Estimé :** 5 points | **Labels :** `maintenance`, `phase-1` | **Dépend de :** Story 4.1

---

### Story 6.2: Progression du statut (Owner/Manager)

As an **Owner or mandated Manager**,
I want to update the status of a maintenance request,
So that the tenant is kept informed of progress.

**Acceptance Criteria:**

**Given** a PATCH to `/api/maintenance/:id/status` with `{ status: 'IN_PROGRESS' | 'RESOLVED' }` and optional comment
**When** authenticated as Owner (own property) or mandated Manager
**Then** the status is updated and MaintenanceStatusChangedEvent is emitted
**And** the Tenant receives an in-app notification + email update

**Given** a PATCH with `{ status: 'CLOSED' }` or `{ status: 'OPEN' }` (reopen)
**When** authenticated as TENANT (own request, status=RESOLVED)
**Then** the status transitions are:
- RESOLVED → CLOSED (tenant closes)
- RESOLVED → OPEN (tenant reopens if issue persists)

**Estimé :** 5 points | **Labels :** `maintenance`, `phase-1`

---

### Story 6.3: Listing des maintenances

As an **Owner**,
I want to list maintenance requests with filters,
So that I can manage outstanding issues across my portfolio.

**Acceptance Criteria:**

**Given** a GET to `/api/maintenance` with optional filters (status, urgency, propertyId)
**When** authenticated as OWNER
**Then** only maintenance requests for the Owner's properties are returned, paginated

**When** authenticated as MANAGER
**Then** only requests for mandated properties are returned

**Given** urgency=CRITICAL filter
**When** applied
**Then** only CRITICAL urgency requests are returned regardless of status

**Estimé :** 3 points | **Labels :** `maintenance`, `phase-1`

---

### Story 6.4: Vue maintenances locataire

As a **Tenant**,
I want to view all my maintenance requests and their current status,
So that I can track the resolution of issues I reported.

**Acceptance Criteria:**

**Given** a GET to `/api/maintenance/my-requests`
**When** authenticated as TENANT
**Then** all maintenance requests created by the Tenant are returned, sorted by createdAt DESC
**And** each request shows: title, status, urgency, lastUpdated, comment (if RESOLVED)

**Estimé :** 3 points | **Labels :** `maintenance`, `tenant`, `phase-1`

---

### Story 6.5: Upload de photos pour une maintenance

As a **Tenant or Owner**,
I want to attach photos to a maintenance request,
So that the issue is visually documented for the repair team.

**Acceptance Criteria:**

**Given** a POST to `/api/maintenance/:id/photos` with 1–3 image files
**When** authenticated as the request creator (Tenant) or Owner/Admin
**Then** photos are uploaded to R2 at `maintenance/{requestId}/photos/{photoId}.{ext}`
**And** the photo URLs are added to the maintenance request record
**And** HTTP 201 returns updated photo list

**Estimé :** 5 points | **Labels :** `maintenance`, `storage`, `phase-1`

---

## Epic 7: Agency & Mandate Management

**Goal:** Créer le modèle agence/mandat non exclusif permettant aux Managers de gérer des biens pour le compte d'Owners.

**Covers:** FR-25, FR-26, FR-27, FR-28, FR-37
**Stories :** 8 stories | ~55 points
**Prerequisite:** Story 0.7 (Prisma migrations Phase 2)

### Story 7.1: Création et gestion d'une agence

As an **Admin**,
I want to create and manage agencies on the platform,
So that real estate agencies can operate as managed entities.

**Acceptance Criteria:**

**Given** a POST to `/api/agencies` with name, email, phone, address, and optional rccm
**When** authenticated as ADMIN
**Then** an Agency is created with status=ACTIVE (immediate activation, no KYC)
**And** HTTP 201 returns the agency profile

**Given** a PATCH to `/api/agencies/:id/suspend`
**When** authenticated as ADMIN
**Then** the agency status is set to SUSPENDED and HTTP 200 returned

**Given** a GET to `/api/agencies` with optional filters
**When** authenticated as ADMIN
**Then** all agencies returned, paginated, with member count

**Estimé :** 5 points | **Labels :** `agency`, `phase-2` | **Dépend de :** Story 0.7, 1.5

---

### Story 7.2: Affectation d'un Manager à une Agence

As an **Admin or Agency Admin member**,
I want to assign a Manager user to an agency,
So that the manager can create mandates on behalf of the agency.

**Acceptance Criteria:**

**Given** a POST to `/api/agencies/:id/members` with `{ userId, role: 'MEMBER' | 'ADMIN' }`
**When** the userId refers to a User with role=MANAGER
**Then** an AgencyMember record is created linking the User to the Agency
**And** HTTP 201 returns the member record

**Given** the userId already belongs to another agency (userId unique in agency_members)
**When** assignment is attempted
**Then** HTTP 409 returned with `MANAGER_ALREADY_IN_AGENCY`

**Given** a DELETE to `/api/agencies/:id/members/:memberId`
**When** authenticated as Admin or Agency Admin member
**Then** the AgencyMember record is deleted and HTTP 204 returned

**Estimé :** 5 points | **Labels :** `agency`, `phase-2` | **Dépend de :** Story 7.1

---

### Story 7.3: Création d'un mandat de gestion non exclusif

As an **Owner**,
I want to create a management mandate delegating one of my properties to an agency and its manager,
So that the manager can operate the property on my behalf.

**Acceptance Criteria:**

**Given** a POST to `/api/mandates` with propertyId, agencyId, managerId, startDate, optional endDate, optional commissionType (PERCENTAGE|FIXED), optional commissionValue
**When** authenticated as OWNER (own property) or ADMIN
**Then** the system validates:
- managerId belongs to the agencyId (must be an AgencyMember)
- No duplicate ACTIVE Mandate for the same (property, agency, manager) trio
**And** a Mandate is created with status=ACTIVE
**And** MandateActivatedEvent is emitted
**And** HTTP 201 returns the mandate

**Given** the managerId is not a member of the agencyId
**When** creation is attempted
**Then** HTTP 403 returned with `MANAGER_NOT_IN_AGENCY`

**Given** a duplicate ACTIVE mandate for the same (property, agency, manager)
**When** creation is attempted
**Then** HTTP 409 returned with `MANDATE_ALREADY_EXISTS`

**Estimé :** 13 points | **Labels :** `mandate`, `phase-2`, `critical` | **Dépend de :** Story 7.2, 2.1

---

### Story 7.4: Résiliation d'un mandat

As an **Owner**,
I want to terminate a mandate,
So that the manager loses access to the property without affecting existing lease contracts.

**Acceptance Criteria:**

**Given** a POST to `/api/mandates/:id/terminate` with optional reason
**When** authenticated as Owner (own mandate) or Admin
**Then** the Mandate status is updated to TERMINATED
**And** MandateTerminatedEvent is emitted → Manager access revoked
**And** Active lease Contracts on the property are NOT affected
**And** HTTP 200 returned

**Given** the Mandate is already TERMINATED
**When** termination is attempted
**Then** HTTP 409 returned

**Estimé :** 5 points | **Labels :** `mandate`, `phase-2` | **Dépend de :** Story 7.3

---

### Story 7.5: Listing des mandats (Owner et Manager)

As an **Owner or Manager**,
I want to list my mandates,
So that I can see which properties are delegated and to which agencies.

**Acceptance Criteria:**

**Given** a GET to `/api/mandates` with optional filters (status, propertyId, agencyId)
**When** authenticated as OWNER
**Then** only mandates for the Owner's properties are returned

**When** authenticated as MANAGER
**Then** only mandates where managerId = currentUser.id are returned

**Estimé :** 3 points | **Labels :** `mandate`, `phase-2`

---

### Story 7.6: Profil public d'une agence

As a **Visitor**,
I want to view an agency's public profile,
So that I can evaluate the agency before contacting them.

**Acceptance Criteria:**

**Given** a GET to `/api/agencies/:id/public` (`@Public()`)
**When** any user (authenticated or not) requests it
**Then** HTTP 200 returns: agency name, address, phone, email, count of published managed properties
**And** the response is cached in Redis at `agency:{agencyId}:profile` with TTL 30 min

**Estimé :** 3 points | **Labels :** `agency`, `cache`, `public`, `phase-2`

---

### Story 7.7: Paramètres de commission dans le mandat

As an **Owner**,
I want to configure commission parameters when creating a mandate,
So that management commissions are automatically calculated when rents are collected.

**Acceptance Criteria:**

**Given** a Mandate is created with `commissionType: 'PERCENTAGE'` and `commissionValue: 5.0`
**When** a Payment is registered as PAID on a contract for that property
**Then** `amountHT = Math.round(rent * 5.0 / 100)` (integer FCFA)
**And** `tvaAmount = Math.round(amountHT * 19.25 / 100)` (integer FCFA)
**And** `amountTTC = amountHT + tvaAmount` (integer FCFA)
**And** all three values are stored in the Commission record

**Given** a Mandate with `commissionType: 'FIXED'` and `commissionValue: 15000`
**When** a Payment is registered
**Then** `amountHT = 15000`, TVA calculated on top

**Given** a Mandate with no commissionType
**When** a Payment is registered
**Then** no Commission is auto-generated for this Mandate

**Estimé :** 5 points | **Labels :** `mandate`, `commission`, `phase-2` | **Dépend de :** Story 5.1

---

### Story 7.8: Cron — Expiration automatique des mandats

As a **system**,
I want mandates with a past endDate to be automatically expired,
So that access rights are revoked without manual intervention.

**Acceptance Criteria:**

**Given** a cron job runs daily
**When** mandates exist with endDate < today AND status = ACTIVE
**Then** each mandate status is updated to EXPIRED
**And** MandateTerminatedEvent is emitted for each
**And** the cron logs `"Expired {n} mandates."`

**Estimé :** 3 points | **Labels :** `mandate`, `cron`, `phase-2`

---

## Epic 8: Commission Management

**Goal:** Tracer toutes les commissions dues aux agences — auto-générées sur encaissement et manuelles — avec génération PDF des reçus.

**Covers:** FR-29, FR-30, FR-31, FR-38
**Stories :** 6 stories | ~34 points
**Prerequisite:** EP-7 (mandats avec paramètres commission) + Story 5.1 (registerPayment)

### Story 8.1: Auto-génération commission MANAGEMENT (dans registerPayment)

As a **system**,
I want management commissions automatically created when rent is collected,
So that no commission is ever missed regardless of who registers the payment.

**Acceptance Criteria:**

**Given** a payment is marked PAID via Story 5.1
**When** one or more active Mandates with commissionType exist on the property
**Then** for each such Mandate, a Commission MANAGEMENT is created in the SAME UnitOfWork transaction as the payment:
- `type = MANAGEMENT`
- `mandateId = mandate.id`
- `contractId = contract.id`
- `agencyId = mandate.agencyId`
- Amounts calculated as integers (FCFA): amountHT, tvaAmount (19.25% snapshot), amountTTC
- `status = PENDING`
**And** CommissionGeneratedEvent is emitted per Commission
**And** event handler queues email to Owner with commission details

**Given** multiple active Mandates with commissionType on the same property
**When** a payment is registered
**Then** one Commission is created per Mandate (non-exclusive mandate logic)

**Estimé :** 8 points | **Labels :** `commission`, `phase-2`, `critical` | **Dépend de :** Story 5.1, 7.3

---

### Story 8.2: Création manuelle d'une commission (PLACEMENT / EXCEPTIONAL)

As a **mandated Manager**,
I want to create a commission manually for placement or exceptional fees,
So that all remuneration is formally tracked regardless of when or how it arises.

**Acceptance Criteria:**

**Given** a POST to `/api/commissions` with contractId, type (PLACEMENT|EXCEPTIONAL), amountHT (integer FCFA), optional description
**When** authenticated as MANAGER with an active Mandate on the contract's property, or ADMIN
**Then** TVA 19.25% is calculated automatically: `tvaAmount = Math.round(amountHT * 19.25 / 100)`, `amountTTC = amountHT + tvaAmount`
**And** Commission is created with `status = PENDING`
**And** CommissionGeneratedEvent is emitted → Owner in-app notification + email

**Given** the Commission is later marked PAID
**When** any modification is attempted
**Then** HTTP 409 returned with `COMMISSION_ALREADY_PAID` (immutable after PAID)

**Estimé :** 5 points | **Labels :** `commission`, `phase-2` | **Dépend de :** Story 7.3

---

### Story 8.3: Validation d'une commission (Owner → PAID)

As an **Owner**,
I want to mark a commission as paid and get a receipt,
So that the agency receives formal confirmation of payment.

**Acceptance Criteria:**

**Given** a POST to `/api/commissions/:id/pay` with paymentMethod and reference
**When** authenticated as the Owner (property owner) and Commission is PENDING
**Then** Commission status updated to PAID, paidAt set to now()
**And** CommissionPaidEvent is emitted → event handlers:
- PdfService generates commission receipt PDF synchronously
- Uploaded to R2 at `commissions/{commissionId}/receipt.pdf`
- Commission.receiptUrl updated
- Manager notified (in-app + email with receiptUrl)
**And** HTTP 200 returns updated Commission with receiptUrl

**Given** Commission status is already PAID
**When** pay is attempted
**Then** HTTP 409 returned with `COMMISSION_ALREADY_PAID`

**Estimé :** 8 points | **Labels :** `commission`, `pdf`, `phase-2` | **Dépend de :** Story 0.3, 8.1

---

### Story 8.4: Annulation d'une commission PENDING

As an **Owner or Admin**,
I want to cancel a pending commission,
So that erroneous or disputed commissions can be voided before payment.

**Acceptance Criteria:**

**Given** a POST to `/api/commissions/:id/cancel`
**When** authenticated as Owner (own property) or Admin, and Commission is PENDING
**Then** Commission status updated to CANCELLED and HTTP 200 returned

**Given** Commission status is PAID
**When** cancellation is attempted
**Then** HTTP 409 returned with `COMMISSION_ALREADY_PAID`

**Estimé :** 3 points | **Labels :** `commission`, `phase-2`

---

### Story 8.5: Listing et reporting des commissions

As a **Manager or Admin**,
I want to view and filter commissions with aggregated totals,
So that I can track agency revenue and outstanding receivables.

**Acceptance Criteria:**

**Given** a GET to `/api/commissions` with filters (status, type, agencyId, contractId, dateFrom, dateTo)
**When** authenticated as MANAGER
**Then** only commissions for the Manager's agency are returned, paginated

**When** authenticated as ADMIN
**Then** all commissions across all agencies are returned

**Given** a GET to `/api/commissions/dashboard`
**When** authenticated as MANAGER
**Then** HTTP 200 returns (cached Redis `commissions:{agencyId}:dashboard` TTL 5 min):
- Total PAID commissions for current month (HT + TVA + TTC)
- Total PENDING commissions
- Breakdown by type (PLACEMENT / MANAGEMENT / EXCEPTIONAL)
- Top 5 owners by commission volume

**Estimé :** 5 points | **Labels :** `commission`, `phase-2`

---

### Story 8.6: Vue commissions Owner

As an **Owner**,
I want to see all commissions due on my properties,
So that I know what I owe to each agency and can pay efficiently.

**Acceptance Criteria:**

**Given** a GET to `/api/commissions/my-due`
**When** authenticated as OWNER
**Then** all commissions where the linked contract's property belongs to the Owner are returned
**And** grouped by agency with PENDING subtotal and PAID subtotal

**Estimé :** 5 points | **Labels :** `commission`, `phase-2`

---

## Epic 9: Dashboard & Analytics

**Goal:** Fournir à chaque rôle un tableau de bord analytique en temps réel avec cache Redis.

**Covers:** FR-32, FR-33, FR-34, FR-35
**Stories :** 5 stories | ~34 points
**Prerequisite:** All previous Epics deployed

### Story 9.1: KPIs de portefeuille (Owner/Manager)

As an **Owner or Manager**,
I want a real-time dashboard showing my portfolio KPIs,
So that I can identify issues and make decisions at a glance.

**Acceptance Criteria:**

**Given** a GET to `/api/dashboard/portfolio`
**When** authenticated as OWNER
**Then** HTTP 200 returns (cached `dashboard:{userId}:metrics` TTL 5 min):
- Count of properties by status (AVAILABLE, RENTED, MAINTENANCE, RESERVED)
- Occupancy rate: `RENTED / total` as percentage
- Monthly revenue: sum of PAID payments for current month (FCFA)
- Late payments: count + total amount LATE
- Contracts expiring within 30 days: count + list

**Given** the cache is fresh (< 5 min old)
**When** the endpoint is called
**Then** the cached value is returned without a database query

**Given** a WRITE event occurs (payment registered, contract created, etc.)
**When** the event handler executes
**Then** `dashboard:{userId}:metrics` is invalidated (cache key deleted)

**Estimé :** 8 points | **Labels :** `dashboard`, `cache`, `phase-3` | **Dépend de :** Story 0.6

---

### Story 9.2: KPIs de maintenances

As an **Owner or Manager**,
I want to see maintenance KPIs on my dashboard,
So that I can prioritize urgent repair issues.

**Acceptance Criteria:**

**Given** a GET to `/api/dashboard/maintenance`
**When** authenticated as OWNER or MANAGER
**Then** HTTP 200 returns:
- Open requests by urgency (LOW/NORMAL/HIGH/CRITICAL counts)
- Average resolution time (OPEN → RESOLVED) over the last 30 days in hours
- Count of CRITICAL open requests (highlighted)

**Estimé :** 5 points | **Labels :** `dashboard`, `maintenance`, `phase-3`

---

### Story 9.3: KPIs commissions agence

As a **Manager**,
I want to see commission KPIs for my agency on the dashboard,
So that I can track monthly earnings and pending receivables.

**Acceptance Criteria:**

**Given** a GET to `/api/dashboard/commissions`
**When** authenticated as MANAGER
**Then** HTTP 200 returns (cached `commissions:{agencyId}:dashboard` TTL 5 min):
- Commissions encaissées ce mois: total HT, TVA, TTC
- Commissions en attente: total TTC
- Top 5 owners by commission volume (owner name + total TTC)
- Breakdown by type: PLACEMENT vs MANAGEMENT vs EXCEPTIONAL

**Estimé :** 8 points | **Labels :** `dashboard`, `commission`, `cache`, `phase-3`

---

### Story 9.4: KPIs Admin plateforme

As an **Admin**,
I want a platform-wide analytics dashboard,
So that I can monitor growth, identify issues, and report to stakeholders.

**Acceptance Criteria:**

**Given** a GET to `/api/dashboard/admin`
**When** authenticated as ADMIN
**Then** HTTP 200 returns:
- Active users by role (OWNER count, MANAGER count, TENANT count)
- Total properties on platform: published / by status
- Active contracts count
- Late payments: count + total amount
- Monthly platform revenue (sum of all PAID commissions)
- Top 5 most active agencies (by contracts under management)

**Estimé :** 8 points | **Labels :** `dashboard`, `admin`, `phase-3`

---

### Story 9.5: Vue tableau de bord locataire

As a **Tenant**,
I want to see my personal dashboard,
So that I know my contract status, upcoming payments, and open maintenance requests at a glance.

**Acceptance Criteria:**

**Given** a GET to `/api/dashboard/tenant`
**When** authenticated as TENANT
**Then** HTTP 200 returns:
- Active contract: property address, rent amount, start/end dates
- Next payment due: amount, dueDate, status (PENDING/LATE)
- Payment history summary: last 3 payments (date, amount, status)
- Open maintenance requests: count by status

**Estimé :** 5 points | **Labels :** `dashboard`, `tenant`, `phase-3`
