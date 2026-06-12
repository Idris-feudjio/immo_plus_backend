---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
inputDocuments:
  - "_bmad-output/planning-artifacts/prds/prd-immo-plus-backend-2026-06-12/prd.md"
  - "_bmad-output/project-context.md"
  - "src/ (codebase analysée)"
workflowType: architecture
project_name: immo-plus-backend
user_name: Idris Feudjio
date: 2026-06-12
status: final
---

# Architecture — Immo Plus CM Backend

> Architecture cible : **Clean Architecture + Domain Driven Design + CQRS + Event-Driven**
> Stack : NestJS 11 · Prisma 7 · PostgreSQL · Redis · BullMQ · Cloudflare R2

---

## 0. Principes Directeurs

| Principe | Application concrète |
|----------|---------------------|
| **Dependency Inversion** | Le domaine ne dépend jamais de Prisma ou de NestJS. Les repos sont des interfaces dans le domaine, implémentées dans l'infrastructure. |
| **Aggregate-first** | Toute écriture passe par l'Aggregate Root — jamais de `prisma.xxx.update()` direct dans un service applicatif. |
| **CQRS ciblé** | Commands (mutations) via handlers dédiés. Queries (lectures complexes) via des Query Services optimisés avec projections Prisma. Pas de sur-ingénierie sur les CRUD simples. |
| **Domain Events** | Les effets de bord (PDF, commissions, notifications, statuts) sont déclenchés par des événements de domaine, pas par des appels directs entre services. |
| **Pas de logique dans les controllers** | Les controllers reçoivent, délèguent et répondent. Toute règle métier est dans le domaine ou l'application. |
| **Monorepo modulaire** | Un module NestJS par Bounded Context. Les dépendances inter-modules passent uniquement par des interfaces publiées, jamais par import direct de services. |

---

## 1. Bounded Contexts

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Immo Plus CM                                │
│                                                                     │
│  ┌───────────┐  ┌────────────┐  ┌──────────────┐  ┌─────────────┐ │
│  │ Identity  │  │  Property  │  │   Tenancy    │  │    Lease    │ │
│  │ (Auth +   │  │ (Biens +   │  │ (Tenants +   │  │ (Contracts +│ │
│  │  Users)   │  │  Médias)   │  │ Applications)│  │  Clauses)   │ │
│  └───────────┘  └────────────┘  └──────────────┘  └─────────────┘ │
│                                                                     │
│  ┌───────────┐  ┌────────────┐  ┌──────────────┐  ┌─────────────┐ │
│  │ Payment   │  │Maintenance │  │   Agency     │  │ Commission  │ │
│  │(Paiements │  │(Demandes   │  │(Agences +    │  │(Commissions │ │
│  │+Quittances│  │ de travaux)│  │  Mandats)    │  │ auto+manuel)│ │
│  └───────────┘  └────────────┘  └──────────────┘  └─────────────┘ │
│                                                                     │
│  ┌───────────────────────────┐  ┌──────────────────────────────┐   │
│  │  Notification (cross-cut) │  │  Analytics / Dashboard       │   │
│  └───────────────────────────┘  └──────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. Convention de Dossiers

### 2.1 Structure cible par module (Clean Architecture)

```
src/
└── {bounded-context}/
    ├── domain/
    │   ├── entities/             # Entités domaine (pas Prisma, type pur)
    │   ├── value-objects/        # Value Objects immuables
    │   ├── events/               # Domain Events (classes)
    │   └── repositories/         # Interfaces des repos (ports)
    ├── application/
    │   ├── commands/             # Command classes + handlers (CQRS)
    │   ├── queries/              # Query classes + handlers (CQRS)
    │   ├── dtos/                 # Input DTOs (class-validator)
    │   ├── view-models/          # Output shapes (read-side)
    │   └── event-handlers/       # Domain event subscribers
    ├── infrastructure/
    │   ├── repositories/         # Implémentations Prisma des interfaces
    │   ├── mappers/              # Prisma Model ↔ Domain Entity
    │   └── cache/                # Wrappers Redis spécifiques au module
    └── presentation/
        ├── {module}.controller.ts
        └── {module}.module.ts
```

### 2.2 Modules existants — migration progressive

Les modules existants (`properties`, `contracts`, `payments`, etc.) conservent leur structure actuelle mais **migrent progressivement** vers ce pattern. La priorité est donnée aux nouveaux modules (`agency`, `mandate`, `commission`).

### 2.3 Modules communs (`src/common/`)

```
src/common/
├── abstractions/          # BaseRepository, BaseService, BaseController (conservés)
├── decorators/            # @Public(), @Roles(), @CurrentUser(), @Mandated() (nouveau)
├── guards/                # JwtAuthGuard, RolesGuard, MandateGuard (nouveau)
├── interceptors/          # TransformInterceptor, LoggingInterceptor, CacheInterceptor
├── filters/               # GlobalExceptionFilter
├── events/                # EventBus abstraction, DomainEvent base class
├── interfaces/            # SearchRequest, PaginatedResult, IRepository
├── dto/                   # PaginationDto
└── utils/                 # pagination.util, slug.util
```

---

## 3. Modules NestJS — Carte complète

| Module | Bounded Context | Responsabilité |
|--------|----------------|----------------|
| `PrismaModule` | Infrastructure | PrismaService (global) |
| `DatabaseModule` | Infrastructure | UnitOfWorkService (global) |
| `RedisCacheModule` | Infrastructure | CacheService (global) |
| `StorageModule` | Infrastructure | StorageService (global) |
| `EventModule` | Infrastructure | EventBus (NestJS EventEmitter2, global) |
| `AuthModule` | Identity | Register, Login, OTP, JWT, Refresh, Reset |
| `UsersModule` | Identity | Profil utilisateur |
| `PropertiesModule` | Property | CRUD, images, documents, publication |
| `TenantsModule` | Tenancy | Profils locataires |
| `ApplicationsModule` | Tenancy | Candidatures publiques (nouveau) |
| `ContractsModule` | Lease | Contrats, renouvellement, résiliation |
| `PaymentsModule` | Payment | Enregistrement, quittances PDF |
| `MaintenanceModule` | Maintenance | Demandes de travaux |
| `AgencyModule` | Agency | Agences, membres |
| `MandateModule` | Agency | Mandats de gestion non exclusifs |
| `CommissionModule` | Commission | Commissions auto + manuelles |
| `NotificationsModule` | Notification | Notifications in-app |
| `MessagesModule` | Notification | Messages inter-utilisateurs |
| `DashboardModule` | Analytics | KPIs agrégés |
| `AdminModule` | Administration | Settings globaux, supervision |
| `CronModule` | Scheduled Jobs | Cron jobs (retards, expirations, alertes) |

---

## 4. Modèle de Domaine — Aggregates & Entities

### 4.1 Aggregate: `Property`

```
PropertyAggregate (Root: Property)
├── PropertyImage[]         # max 4, 1 cover obligatoire si images présentes
└── PropertyDocument[]

Invariants :
  - max 4 images
  - cover auto-assignée au premier upload
  - soft-delete (deletedAt) si pas de contrat ACTIVE
  - slug unique = slugify(title) + uuid(8)
  - RENTED uniquement via ContractCreatedEvent
```

### 4.2 Aggregate: `Contract`

```
ContractAggregate (Root: Contract)
├── ContractClause[]        # clauses personnalisées
└── (Payments générés au create — entités séparées via PaymentAggregate)

Invariants :
  - 1 seul ACTIVE par Property
  - échéancier généré à la création (dueDate = 5 du mois)
  - renouvellement = nouveau Contract + parentContractId
  - résiliation = TERMINATED + pending payments CANCELLED
```

### 4.3 Aggregate: `Payment`

```
PaymentAggregate (Root: Payment)
└── Receipt (Value Object — pdfUrl, generatedAt)

Invariants :
  - transition PENDING/LATE → PAID uniquement
  - PAID déclenche PaymentRegisteredEvent (PDF + commission)
  - dueDate = 5 du mois pour chaque échéance
  - montant = rent + fees
```

### 4.4 Aggregate: `Agency` *(nouveau)*

```
AgencyAggregate (Root: Agency)
└── AgencyMember[]

Invariants :
  - un Manager (userId) ne peut appartenir qu'à une seule Agence
  - statuts : ACTIVE, SUSPENDED
  - RCCM optionnel, non validé en MVP
```

### 4.5 Aggregate: `Mandate` *(nouveau)*

```
MandateAggregate (Root: Mandate)
├── Propriété : propertyId, agencyId, managerId
├── Commission params : commissionType (PERCENTAGE|FIXED), commissionValue
└── Statut : ACTIVE, TERMINATED, EXPIRED

Invariants :
  - non-exclusif : plusieurs Mandats ACTIVE par Property autorisés
  - Manager doit appartenir à l'Agence du Mandat
  - résiliation ne supprime pas les Contrats en cours
  - si commissionType défini → auto-génération Commission sur chaque PAID
```

### 4.6 Aggregate: `Commission` *(nouveau)*

```
CommissionAggregate (Root: Commission)
├── Ref : mandateId (nullable pour manual), contractId, agencyId
├── Montants : amountHT, tvaRate (19.25%), tvaAmount, amountTTC
└── Statuts : PENDING, PAID, CANCELLED

Invariants :
  - immuable après PAID
  - montants stockés en entiers (FCFA)
  - TVA calculée au moment de la création (snapshot, pas recalculé)
```

### 4.7 Entity: `Application` *(candidature — déjà dans schéma)*

```
Application
├── propertyId, tenantId (nullable pour visiteur)
├── message, income, occupation
└── Statuts : PENDING, ACCEPTED, REJECTED

Règles :
  - submission sans authentification possible (portail public)
  - conversion manuelle en Tenant+Contract par l'Owner/Manager
```

### 4.8 Value Objects

```
Money        { amount: Int, currency: 'FCFA' }
TvaAmount    { ht: Int, tvaRate: Decimal, tva: Int, ttc: Int }
DateRange    { startDate: Date, endDate: Date }   // Contract period
Slug         { value: string }                    // `{title}-{uuid8}`
CommissionRate { type: 'PERCENTAGE'|'FIXED', value: Decimal }
```

---

## 5. CQRS — Catalogue Commands & Queries

### 5.1 Commands (mutations — via handlers)

#### Identity
| Command | Handler | Événement émis |
|---------|---------|---------------|
| `RegisterUserCommand` | `RegisterUserHandler` | `UserRegisteredEvent` |
| `VerifyEmailCommand` | `VerifyEmailHandler` | `EmailVerifiedEvent` |
| `LoginCommand` | `LoginHandler` | — |
| `RefreshTokenCommand` | `RefreshTokenHandler` | — |

#### Property
| Command | Handler | Événement émis |
|---------|---------|---------------|
| `CreatePropertyCommand` | `CreatePropertyHandler` | `PropertyCreatedEvent` |
| `PublishPropertyCommand` | `PublishPropertyHandler` | `PropertyPublishedEvent` |
| `UpdatePropertyCommand` | `UpdatePropertyHandler` | — |
| `SoftDeletePropertyCommand` | `SoftDeletePropertyHandler` | `PropertyDeletedEvent` |
| `AddPropertyImagesCommand` | `AddPropertyImagesHandler` | — |
| `SetCoverImageCommand` | `SetCoverImageHandler` | — |
| `SubmitApplicationCommand` | `SubmitApplicationHandler` | `ApplicationSubmittedEvent` |

#### Lease
| Command | Handler | Événement émis |
|---------|---------|---------------|
| `CreateContractCommand` | `CreateContractHandler` | `ContractCreatedEvent` |
| `RenewContractCommand` | `RenewContractHandler` | `ContractRenewedEvent` |
| `TerminateContractCommand` | `TerminateContractHandler` | `ContractTerminatedEvent` |
| `GenerateContractPdfCommand` | `GenerateContractPdfHandler` | — |

#### Payment
| Command | Handler | Événement émis |
|---------|---------|---------------|
| `RegisterPaymentCommand` | `RegisterPaymentHandler` | `PaymentRegisteredEvent` |

#### Maintenance
| Command | Handler | Événement émis |
|---------|---------|---------------|
| `CreateMaintenanceCommand` | `CreateMaintenanceHandler` | `MaintenanceCreatedEvent` |
| `UpdateMaintenanceStatusCommand` | `UpdateMaintenanceStatusHandler` | `MaintenanceStatusChangedEvent` |

#### Agency / Mandate
| Command | Handler | Événement émis |
|---------|---------|---------------|
| `CreateAgencyCommand` | `CreateAgencyHandler` | `AgencyCreatedEvent` |
| `AddAgencyMemberCommand` | `AddAgencyMemberHandler` | — |
| `CreateMandateCommand` | `CreateMandateHandler` | `MandateActivatedEvent` |
| `TerminateMandateCommand` | `TerminateMandateHandler` | `MandateTerminatedEvent` |

#### Commission
| Command | Handler | Événement émis |
|---------|---------|---------------|
| `CreateManualCommissionCommand` | `CreateManualCommissionHandler` | `CommissionGeneratedEvent` |
| `MarkCommissionPaidCommand` | `MarkCommissionPaidHandler` | `CommissionPaidEvent` |

### 5.2 Queries (lectures — via Query Services optimisés)

```typescript
// Toutes les queries retournent des View Models (pas des Entities domaine)

GetPropertyBySlugQuery      → PropertyDetailViewModel
ListPublicPropertiesQuery    → PaginatedResult<PropertyListItemViewModel>
ListDashboardPropertiesQuery → PaginatedResult<PropertyListItemViewModel>
GetContractByIdQuery         → ContractDetailViewModel
ListContractsQuery           → PaginatedResult<ContractListItemViewModel>
GetTenantProfileQuery        → TenantProfileViewModel
ListPaymentsQuery            → PaginatedResult<PaymentViewModel>
GetDashboardMetricsQuery     → DashboardMetricsViewModel  // cached Redis
GetAgencyProfileQuery        → AgencyProfileViewModel     // cached Redis
ListMandatesQuery            → PaginatedResult<MandateViewModel>
ListCommissionsQuery         → PaginatedResult<CommissionViewModel>
GetCommissionDashboardQuery  → CommissionDashboardViewModel // cached Redis
```

---

## 6. Domain Events — Catalogue complet

### 6.1 Classe de base

```typescript
// src/common/events/domain-event.base.ts
export abstract class DomainEvent {
  readonly occurredAt: Date = new Date();
  readonly eventId: string = uuidv4();
  abstract readonly eventName: string;
}
```

### 6.2 Catalogue

| Event | Émis par | Handlers abonnés |
|-------|----------|-----------------|
| `ContractCreatedEvent` | `CreateContractHandler` | `GeneratePaymentScheduleHandler`, `SetPropertyRentedHandler`, `NotifyTenantContractCreatedHandler` |
| `ContractExpiredEvent` | `CronService` | `SetPropertyAvailableHandler`, `CancelPendingPaymentsHandler`, `NotifyContractExpiredHandler` |
| `ContractTerminatedEvent` | `TerminateContractHandler` | `SetPropertyAvailableHandler`, `CancelPendingPaymentsAfterTerminationHandler`, `NotifyTenantTerminatedHandler` |
| `ContractRenewedEvent` | `RenewContractHandler` | `GeneratePaymentScheduleHandler`, `NotifyTenantRenewedHandler` |
| `PaymentRegisteredEvent` | `RegisterPaymentHandler` | `GenerateReceiptPdfHandler`, `AutoGenerateCommissionHandler`, `NotifyTenantPaidHandler` |
| `PaymentLateEvent` | `CronService` | `SendPaymentLateAlertHandler` |
| `MaintenanceCreatedEvent` | `CreateMaintenanceHandler` | `NotifyOwnerMaintenanceHandler` |
| `MaintenanceStatusChangedEvent` | `UpdateMaintenanceStatusHandler` | `NotifyTenantMaintenanceStatusHandler` |
| `ApplicationSubmittedEvent` | `SubmitApplicationHandler` | `NotifyOwnerApplicationHandler` |
| `MandateActivatedEvent` | `CreateMandateHandler` | `GrantManagerAccessHandler` |
| `MandateTerminatedEvent` | `TerminateMandateHandler` | `RevokeManagerAccessHandler` |
| `CommissionGeneratedEvent` | `AutoGenerateCommissionHandler` | `NotifyOwnerCommissionGeneratedHandler` |
| `CommissionPaidEvent` | `MarkCommissionPaidHandler` | `GenerateCommissionReceiptHandler`, `NotifyManagerCommissionPaidHandler` |

### 6.3 Bus d'événements

```typescript
// Utilise NestJS EventEmitter2 (in-process, synchrone)
// Pour les effets asynchrones (email, PDF), déléguer à BullMQ dans les handlers

import { EventEmitter2 } from '@nestjs/event-emitter';

// Émission (dans un handler):
this.eventEmitter.emit(event.eventName, event);

// Réception (dans un handler):
@OnEvent('payment.registered')
async handle(event: PaymentRegisteredEvent) { ... }
```

**Règle :** Les handlers d'événements ne doivent jamais émettre d'autres événements (pas de chaînes d'événements). Évite les cycles et facilite le debugging.

---

## 7. Repositories — Interfaces & Implémentations

### 7.1 Interface de base

```typescript
// src/common/interfaces/repository.interface.ts
export interface IRepository<T, CreateDto, UpdateDto = Partial<CreateDto>> {
  findById(id: string): Promise<T | null>;
  findByIdOrThrow(id: string): Promise<T>;
  findAll(request?: SearchRequest): Promise<T[]>;
  findWithPagination(request: SearchRequest, baseWhere?: object): Promise<PaginatedResult<T>>;
  create(data: CreateDto): Promise<T>;
  update(id: string, data: UpdateDto): Promise<T>;
  delete(id: string): Promise<void>;
  count(request?: SearchRequest): Promise<number>;
  exists(id: string): Promise<boolean>;
}
```

### 7.2 Repositories par module

| Repository | Aggregate | Méthodes custom notables |
|-----------|-----------|-------------------------|
| `PropertyRepository` | Property | `findBySlugPublic`, `findListPaginated`, `softDelete`, `hasActiveContract`, `countImages`, `setCoverImage` |
| `ContractRepository` | Contract | `findByIdWithDetails`, `findActiveForProperty`, `assertAccess` |
| `PaymentRepository` | Payment | `findPendingLate`, `findByContractPaginated`, `markAllPendingCancelled` |
| `TenantRepository` | Tenant | `findWithHistory` |
| `ApplicationRepository` | Application | `findPendingByProperty` |
| `MaintenanceRepository` | Maintenance | `findByPropertyPaginated`, `findOpenCritical` |
| `AgencyRepository` | Agency | `findActiveAgencies`, `findWithMembers` |
| `AgencyMemberRepository` | AgencyMember | `findByUserId`, `findByAgency` |
| `MandateRepository` | Mandate | `findActiveByProperty`, `findActiveByManager`, `findWithCommissionParams` |
| `CommissionRepository` | Commission | `findPendingByAgency`, `findByContractId`, `sumByPeriod` |
| `NotificationRepository` | Notification | `findUnreadByUser`, `markAllRead` |

---

## 8. Application Services — Use Cases clés

### 8.1 `RegisterPaymentUseCase` (critique — multi-effets)

```
RegisterPaymentCommand
  │
  ├─ [1] Valide propriété de Payment (owner/manager du bien)
  ├─ [2] Vérifie statut PENDING/LATE
  ├─ [3] UnitOfWork.execute():
  │       ├─ payment.update(status=PAID, method, reference, paymentDate)
  │       └─ commission auto si Mandate actif avec commissionType:
  │           └─ commission.create(MANAGEMENT, calcul HT/TVA/TTC)
  ├─ [4] Émet PaymentRegisteredEvent
  │
  └─ Handlers asynchrones (via EventEmitter2):
      ├─ GenerateReceiptPdfHandler → PDF sync sur R2, update payment.receiptUrl
      ├─ AutoGenerateCommissionHandler → déjà fait dans UoW, notifie Owner
      └─ NotifyTenantPaidHandler → notification in-app + email avec receiptUrl
```

### 8.2 `CreateContractUseCase` (critique — transaction complexe)

```
CreateContractCommand
  │
  ├─ [1] Vérifie droits Owner/Manager sur le bien
  ├─ [2] Vérifie disponibilité (AVAILABLE/RESERVED)
  ├─ [3] Vérifie absence de contrat ACTIVE existant
  ├─ [4] UnitOfWork.execute():
  │       ├─ contract.create(+ clauses)
  │       ├─ property.update(status=RENTED)
  │       ├─ payment.createMany(échéancier mensuel)
  │       └─ notification.create(tenant)
  └─ [5] Émet ContractCreatedEvent
```

### 8.3 `CreateMandateUseCase` *(nouveau)*

```
CreateMandateCommand
  │
  ├─ [1] Vérifie que le Manager appartient bien à l'Agence
  ├─ [2] Vérifie que l'Owner est propriétaire du bien
  ├─ [3] Vérifie qu'il n'existe pas de Mandat ACTIVE en double
  │       pour le même trio (property, agency, manager)
  ├─ [4] mandate.create(propriété + agencyId + managerId + commissionParams)
  └─ [5] Émet MandateActivatedEvent
```

### 8.4 `AutoGenerateCommissionUseCase` *(nouveau, appelé depuis handler)*

```
PaymentRegisteredEvent
  │
  └─ AutoGenerateCommissionHandler:
      ├─ MandateRepository.findActiveByProperty(propertyId)
      ├─ Pour chaque Mandate avec commissionType défini:
      │   ├─ Calcule montantHT selon type (PERCENTAGE|FIXED)
      │   ├─ Calcule TVA = round(amountHT * 19.25 / 100)
      │   ├─ TTC = amountHT + tvaAmount
      │   └─ commission.create(type=MANAGEMENT, mandate, contract, montants)
      └─ Émet CommissionGeneratedEvent pour chaque commission créée
```

---

## 9. DTOs — Conventions

### 9.1 Règles globales

```typescript
// Input DTOs (class-validator + class-transformer)
// - Suffixe : Dto (ex: CreatePropertyDto, FilterContractsDto)
// - Toujours @ApiProperty / @ApiPropertyOptional sur chaque champ
// - @IsOptional() + valeur par défaut quand optionnel
// - Pas de logique dans les DTOs

// Output View Models (pas de décorateurs de validation)
// - Suffixe : Vm ou ViewModel (ex: PropertyDetailVm, DashboardMetricsVm)
// - Construits via des mappers depuis les entités domaine
```

### 9.2 DTOs nouveaux modules

```typescript
// Agency
CreateAgencyDto    { name, email, phone, address?, rccm? }
UpdateAgencyDto    { name?, email?, phone?, address?, rccm? }
AddAgencyMemberDto { userId, role: 'MEMBER' | 'ADMIN' }

// Mandate
CreateMandateDto   { propertyId, agencyId, managerId, startDate, endDate?,
                     description?,
                     commissionType?: 'PERCENTAGE' | 'FIXED',
                     commissionValue?: number }
TerminateMandateDto { terminationDate: string, reason?: string }

// Commission
CreateManualCommissionDto { contractId, mandateId?, type: 'PLACEMENT'|'EXCEPTIONAL',
                            amountHT: number, description?: string }
MarkCommissionPaidDto     { paymentMethod: PaymentMethod, reference: string }

// Application (candidature publique)
SubmitApplicationDto { propertyId, firstName, lastName, email, phone,
                       message?, income?, occupation? }
```

---

## 10. Schéma Prisma — Nouvelles Entités

### 10.1 Enums à ajouter

```prisma
enum AgencyStatus {
  ACTIVE
  SUSPENDED
}

enum AgencyMemberRole {
  MEMBER
  ADMIN
}

enum MandateStatus {
  ACTIVE
  TERMINATED
  EXPIRED
}

enum CommissionType {
  PERCENTAGE
  FIXED
}

enum CommissionCategory {
  PLACEMENT
  MANAGEMENT
  EXCEPTIONAL
}

enum CommissionStatus {
  PENDING
  PAID
  CANCELLED
}
```

### 10.2 Modèles à ajouter

```prisma
model Agency {
  id        String       @id @default(uuid())
  name      String       @db.VarChar(255)
  email     String       @unique @db.VarChar(255)
  phone     String       @db.VarChar(20)
  address   String?
  rccm      String?      @db.VarChar(100)
  status    AgencyStatus @default(ACTIVE)
  createdAt DateTime     @default(now())
  updatedAt DateTime     @updatedAt

  members     AgencyMember[]
  mandates    Mandate[]
  commissions Commission[]

  @@map("agencies")
}

model AgencyMember {
  id       String           @id @default(uuid())
  agencyId String
  userId   String           @unique      // un Manager = une seule Agence
  role     AgencyMemberRole @default(MEMBER)
  joinedAt DateTime         @default(now())

  agency Agency @relation(fields: [agencyId], references: [id])
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("agency_members")
}

model Mandate {
  id              String         @id @default(uuid())
  propertyId      String
  agencyId        String
  managerId       String
  status          MandateStatus  @default(ACTIVE)
  startDate       DateTime       @db.Date
  endDate         DateTime?      @db.Date
  commissionType  CommissionType?
  commissionValue Decimal?       @db.Decimal(10, 2)
  description     String?
  deletedAt       DateTime?
  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt

  property    Property     @relation(fields: [propertyId], references: [id])
  agency      Agency       @relation(fields: [agencyId], references: [id])
  manager     User         @relation("MandateManager", fields: [managerId], references: [id])
  commissions Commission[]

  @@index([propertyId, status])
  @@index([agencyId, status])
  @@index([managerId, status])
  @@map("mandates")
}

model Commission {
  id            String             @id @default(uuid())
  mandateId     String?
  contractId    String
  agencyId      String
  type          CommissionCategory
  amountHT      Int
  tvaRate       Decimal            @default(19.25) @db.Decimal(5, 2)
  tvaAmount     Int
  amountTTC     Int
  description   String?
  status        CommissionStatus   @default(PENDING)
  paymentMethod PaymentMethod?
  reference     String?            @db.VarChar(100)
  receiptUrl    String?
  paidAt        DateTime?
  createdAt     DateTime           @default(now())
  updatedAt     DateTime           @updatedAt

  mandate  Mandate?  @relation(fields: [mandateId], references: [id])
  contract Contract  @relation(fields: [contractId], references: [id])
  agency   Agency    @relation(fields: [agencyId], references: [id])

  @@index([agencyId, status])
  @@index([contractId])
  @@map("commissions")
}
```

### 10.3 Relations à ajouter sur les modèles existants

```prisma
// Sur User — ajouter :
agencyMembership AgencyMember?
managedMandates  Mandate[]    @relation("MandateManager")

// Sur Property — ajouter :
mandates Mandate[]

// Sur Contract — ajouter :
commissions Commission[]
```

### 10.4 Stratégie de migration

```bash
# Ordre des migrations Prisma :

# 1. Enums (pas de migration SQL, mais mis à jour dans client)
# 2. Agency (table indépendante)
# 3. AgencyMember (dépend de Agency + User)
# 4. Mandate (dépend de Agency + Property + User)
# 5. Commission (dépend de Mandate + Contract + Agency)

# Commandes :
npx prisma migrate dev --name add_agency_member
npx prisma migrate dev --name add_mandate
npx prisma migrate dev --name add_commission
npx prisma generate
```

---

## 11. Stratégie de Cache Redis

### 11.1 Clés et TTLs

| Clé Redis | Contenu | TTL | Invalidation |
|-----------|---------|-----|-------------|
| `dashboard:{userId}:metrics` | DashboardMetricsVm | 5 min | Sur tout WRITE du portefeuille de l'user |
| `properties:public:{hash}` | PaginatedResult<PropertyListItemVm> | 10 min | Sur `PropertyPublishedEvent` ou update de toute property publiée |
| `agency:{agencyId}:profile` | AgencyProfileVm | 30 min | Sur update de l'agence ou changement de membres |
| `commissions:{agencyId}:dashboard` | CommissionDashboardVm | 5 min | Sur `CommissionPaidEvent` ou `CommissionGeneratedEvent` |
| `tenant:{tenantId}:history` | TenantProfileVm | 15 min | Sur contrat ou paiement lié au tenant |

### 11.2 Pattern d'implémentation

```typescript
// Décorateur @Cacheable existant — étendre avec invalidation par événement

// Dans un Query Handler (exemple Dashboard) :
async execute(query: GetDashboardMetricsQuery) {
  const key = `dashboard:${query.userId}:metrics`;
  const cached = await this.cache.get<DashboardMetricsVm>(key);
  if (cached) return cached;

  const metrics = await this.computeMetrics(query.userId, query.role);
  await this.cache.set(key, metrics, 300); // 5 min
  return metrics;
}

// Invalidation dans un event handler :
@OnEvent('payment.registered')
async invalidateDashboardCache(event: PaymentRegisteredEvent) {
  await this.cache.del(`dashboard:${event.ownerId}:metrics`);
}
```

### 11.3 Règles

- **Ne jamais cacher les données mutables sans TTL** — toujours définir une expiration.
- **Invalidation événementielle** — chaque Domain Event invalide les clés pertinentes.
- **Pas de cache sur les endpoints write** — uniquement sur les queries coûteuses.
- **Clés préfixées par module** — évite les collisions entre modules.
- **Serialisation JSON** — toujours stocker des View Models sérialisés, jamais des entités Prisma brutes.

---

## 12. Stratégie de Sécurité

### 12.1 Couches de protection

```
Request HTTP
  │
  ├─ [1] ThrottlerGuard (global)      200 req/60s/IP
  ├─ [2] JwtAuthGuard (global)        Vérifie Bearer token, popule req.user
  │       └─ @Public() opt-out        Routes publiques (register, login, /properties GET)
  ├─ [3] RolesGuard (global)          Vérifie req.user.role vs @Roles(...)
  ├─ [4] MandateGuard (nouveau)       Vérifie Mandat ACTIVE pour Manager
  └─ [5] Ownership check (service)    Owner/Manager propriétaire du bien
```

### 12.2 Matrice d'autorisation

| Ressource / Action | ADMIN | OWNER | MANAGER | TENANT | VISITOR |
|-------------------|-------|-------|---------|--------|---------|
| Créer Property | ✅ | ✅ | ❌ | ❌ | ❌ |
| Modifier/Supprimer Property | ✅ | ✅ (sien) | ✅ (Mandaté) | ❌ | ❌ |
| Publier Property | ✅ | ✅ (sien) | ✅ (Mandaté) | ❌ | ❌ |
| Voir Property publique | ✅ | ✅ | ✅ | ✅ | ✅ |
| Soumettre Candidature | ✅ | ✅ | ✅ | ✅ | ✅ |
| Traiter Candidature | ✅ | ✅ (sien) | ✅ (Mandaté) | ❌ | ❌ |
| Créer Contrat | ✅ | ✅ (sien) | ✅ (Mandaté) | ❌ | ❌ |
| Renouveler/Résilier Contrat | ✅ | ✅ (sien) | ✅ (Mandaté) | ❌ | ❌ |
| Enregistrer Paiement | ✅ | ✅ (sien) | ✅ (Mandaté) | ❌ | ❌ |
| Créer Maintenance | ✅ | ✅ | ✅ (Mandaté) | ✅ (locataire) | ❌ |
| Gérer Maintenance | ✅ | ✅ (sien) | ✅ (Mandaté) | ❌ | ❌ |
| Créer Agence | ✅ | ❌ | ❌ | ❌ | ❌ |
| Gérer membres Agence | ✅ | ❌ | ✅ (ADMIN de son agence) | ❌ | ❌ |
| Créer Mandat | ✅ | ✅ (son bien) | ❌ | ❌ | ❌ |
| Créer Commission manuelle | ✅ | ❌ | ✅ (Mandaté) | ❌ | ❌ |
| Valider Commission (PAID) | ✅ | ✅ (sien) | ❌ | ❌ | ❌ |
| Dashboard Admin | ✅ | ❌ | ❌ | ❌ | ❌ |
| Config AdminSettings | ✅ | ❌ | ❌ | ❌ | ❌ |

### 12.3 `MandateGuard` *(nouveau)*

```typescript
// src/common/guards/mandate.guard.ts
// Vérifie qu'un Manager a un Mandat ACTIVE sur le propertyId de la requête

@Injectable()
export class MandateGuard implements CanActivate {
  constructor(
    private mandateRepository: MandateRepository,
    private reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { user, params, body } = context.switchToHttp().getRequest();
    if (user.role !== Role.MANAGER) return true; // seuls les managers passent par ce guard

    const propertyId = params.propertyId ?? body.propertyId;
    if (!propertyId) return false;

    const mandate = await this.mandateRepository.findActiveByManager(
      user.id, propertyId
    );
    return mandate !== null;
  }
}
```

### 12.4 Règles de sécurité supplémentaires

- **NEVER retourner `passwordHash`** dans aucune réponse — le `select` Prisma l'exclut toujours.
- **Refresh token rotation** — chaque refresh révoque l'ancien token et en génère un nouveau.
- **OTP rate limiting** — max 3 OTP en 10 minutes par userId.
- **Forgot password anti-enumeration** — réponse identique qu'un compte existe ou non.
- **File upload validation** — type MIME + taille max vérifiés avant upload R2.
- **Données TVA en snapshot** — stocker le taux TVA au moment de la création (pas de recalcul dynamique).

---

## 13. Gestion des erreurs — Codes d'erreur canoniques

```typescript
// Format réponse erreur (GlobalExceptionFilter) :
// { statusCode, error, message, details?, path, timestamp }

// Codes d'erreur par module :

// Auth
EMAIL_ALREADY_EXISTS       409  Email déjà utilisé
PHONE_ALREADY_EXISTS       409  Téléphone déjà utilisé
OTP_INVALID                400  Code OTP invalide ou expiré
OTP_RATE_LIMIT             429  Trop de tentatives OTP
EMAIL_NOT_VERIFIED         401  Email non vérifié
REFRESH_TOKEN_INVALID      401  Refresh token invalide ou révoqué

// Property
PROPERTY_NOT_FOUND         404  Bien introuvable
PROPERTY_HAS_ACTIVE_CONTRACT  409  Suppression impossible - contrat actif
PROPERTY_NOT_AVAILABLE     409  Bien non disponible pour contrat
MAX_IMAGES_REACHED         409  Maximum 4 images par bien
INSUFFICIENT_PERMISSIONS   403  Droits insuffisants sur ce bien

// Contract
CONTRACT_NOT_FOUND         404  Contrat introuvable
CONTRACT_ALREADY_ACTIVE    409  Un contrat actif existe déjà pour ce bien
CONTRACT_NOT_RENEWABLE     409  Contrat non renouvelable dans cet état

// Payment
PAYMENT_NOT_FOUND          404  Paiement introuvable
PAYMENT_ALREADY_PAID       409  Paiement déjà enregistré

// Mandate
MANDATE_NOT_FOUND          404  Mandat introuvable
MANDATE_ALREADY_EXISTS     409  Mandat actif en double (même property/agency/manager)
MANAGER_NOT_IN_AGENCY      403  Manager n'appartient pas à cette agence
NO_ACTIVE_MANDATE          403  Pas de mandat actif pour cette action

// Commission
COMMISSION_NOT_FOUND       404  Commission introuvable
COMMISSION_ALREADY_PAID    409  Commission immuable après PAID
```

---

## 14. Infrastructure — Patterns clés

### 14.1 EventBus (NestJS EventEmitter2)

```typescript
// app.module.ts — ajouter :
EventEmitterModule.forRoot({
  wildcard: true,
  delimiter: '.',
  maxListeners: 20,
  verboseMemoryLeak: true,
})
```

### 14.2 Gestion PDF synchrone

```typescript
// src/common/services/pdf.service.ts
// Utilise une lib de génération PDF (ex: @react-pdf/renderer côté Node ou pdfmake)

@Injectable()
export class PdfService {
  async generateContractPdf(contract: ContractDetailVm): Promise<Buffer> { ... }
  async generateReceiptPdf(payment: PaymentVm): Promise<Buffer> { ... }
  async generateCommissionReceiptPdf(commission: CommissionVm): Promise<Buffer> { ... }
}

// Dans RegisterPaymentHandler :
const buffer = await this.pdfService.generateReceiptPdf(payment);
const key = `receipts/${payment.contractId}/${payment.id}.pdf`;
const url = await this.storageService.uploadBuffer(key, buffer, 'application/pdf');
await this.paymentRepository.update(payment.id, { receiptUrl: url });
```

### 14.3 BullMQ — pour les emails uniquement (MVP)

```typescript
// Queue: 'notifications'
// Jobs : SendEmailJob { to, subject, template, data }

// Dans les event handlers de notification :
await this.notificationQueue.add('send-email', {
  to: tenant.email,
  subject: 'Votre quittance de loyer',
  template: 'receipt',
  data: { receiptUrl, period, amount }
}, { attempts: 3, backoff: { type: 'exponential', delay: 5000 } });
```

---

## 15. Migrations — Ordre et stratégie

```bash
# État actuel : schema.prisma sans Agency/Mandate/Commission
# Migrations à créer dans cet ordre strict :

# M1 — Ajout des enums (dans la même migration que Agency)
npx prisma migrate dev --name "add_agency_with_enums"
# Crée : agencies, agency_members + enums AgencyStatus, AgencyMemberRole

# M2 — Ajout Mandate
npx prisma migrate dev --name "add_mandate"
# Crée : mandates + enums MandateStatus, CommissionType
# Ajoute : Property.mandates, User.managedMandates

# M3 — Ajout Commission
npx prisma migrate dev --name "add_commission"
# Crée : commissions + enums CommissionCategory, CommissionStatus
# Ajoute : Contract.commissions, Agency.commissions

# M4 — Index de performance
npx prisma migrate dev --name "add_performance_indexes"
# Ajoute : indexes sur mandates(propertyId, status), commissions(agencyId, status)

# Après chaque migration :
npx prisma generate
```

---

## 16. Résumé des décisions architecturales

| Décision | Choix | Raison |
|----------|-------|--------|
| CQRS | **Ciblé** (pas full CQRS) | Complexité proportionnelle aux besoins. Commands pour mutations, Query Services pour reads complexes. |
| Event-Driven | **In-process EventEmitter2** | Évite la complexité d'un broker externe (Kafka/RabbitMQ) pour le MVP. Migration possible en v2. |
| PDF | **Synchrone** | OQ-4 confirmé. < 3 s acceptable. BullMQ pour emails uniquement. |
| Mandats | **M:N non exclusifs** | OQ-1 confirmé. Entité `Mandate` comme table de jointure enrichie. |
| Commission | **Auto (MANAGEMENT) + manuel (PLACEMENT/EXCEPTIONAL)** | OQ-2 confirmé. Calculée dans la transaction `registerPayment()`. |
| Cache | **Redis TTL + invalidation événementielle** | Pas de cache sans expiration. Invalidation sur Domain Events. |
| Auth Manager | **MandateGuard** | Remplace le check `property.managerId` par la vérification d'un Mandate ACTIVE. |
| Migrations | **Ordre strict** (Agency → Mandate → Commission) | Respect des contraintes FK Prisma. |
