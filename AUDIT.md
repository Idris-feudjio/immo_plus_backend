# Audit Technique — Immo Plus Backend

**Date** : 2026-06-14  
**Scope** : Codebase complète (`src/`) — 22 modules, ~90 fichiers  
**Stack** : NestJS · TypeScript · Prisma · PostgreSQL · BullMQ · Redis · Cloudflare R2

---

## Table des matières

1. [Architecture générale](#1-architecture-générale)
2. [Schéma Prisma](#2-schéma-prisma)
3. [Audit module par module](#3-audit-module-par-module)
   - [app](#31-app)
   - [auth](#32-auth)
   - [users](#33-users)
   - [admin](#34-admin)
   - [agencies](#35-agencies)
   - [properties](#36-properties)
   - [tenants](#37-tenants)
   - [applications](#38-applications)
   - [mandates](#39-mandates)
   - [contracts](#310-contracts)
   - [payments](#311-payments)
   - [maintenance](#312-maintenance)
   - [commissions](#313-commissions)
   - [messages](#314-messages)
   - [notifications](#315-notifications)
   - [documents (reports)](#316-documents-reports)
   - [dashboard](#317-dashboard)
   - [queue & cron](#318-queue--cron)
   - [cache](#319-cache)
   - [storage](#320-storage)
   - [prisma](#321-prisma)
   - [common / infrastructure](#322-common--infrastructure)
4. [Problèmes critiques & sécurité](#4-problèmes-critiques--sécurité)
5. [Implémentations manquantes](#5-implémentations-manquantes)
6. [Couverture de tests](#6-couverture-de-tests)
7. [Recommandations & roadmap](#7-recommandations--roadmap)

---

## 1. Architecture générale

### Stack & Technologies

| Couche | Technologie |
|---|---|
| Framework | NestJS (TypeScript, `module: nodenext`) |
| ORM | Prisma v7 + adaptateur PrismaPg |
| Base de données | PostgreSQL 16 |
| Cache | ioredis (CacheService global) |
| Queue | BullMQ (Redis) |
| Stockage | Cloudflare R2 (S3-compatible) |
| Email | Nodemailer (SMTP) |
| Auth | JWT RS256 (Passport.js) |

### Setup global (`main.ts`)

- **CORS** : `immoplus.cm`, `www.immoplus.cm`, `localhost:5173`, `localhost:3001`
- **ValidationPipe global** : `whitelist: true`, `forbidNonWhitelisted: true`
- **Guards globaux** (ordre) : `JwtAuthGuard` → `RolesGuard` → `ThrottlerGuard`
- **Interceptors globaux** : `LoggingInterceptor` → `TransformInterceptor`
- **Filter global** : `GlobalExceptionFilter`
- **Swagger** : activé sur `/docs` avec authentification Bearer
- **Throttler** : 200 req / 60 s (global)

### Graphe de dépendances (modules)

```
PrismaModule (Global)
DatabaseModule (UnitOfWork)
RedisCacheModule (Global)
StorageModule (Global)
  └── QueueModule
        └── CronModule
AuthModule ──────────────────────────────── UsersModule
                                                └── AdminModule
PropertiesModule ────────────────────────── TenantsModule
MandatesModule (Global) ─────────────────── AgenciesModule
ContractsModule ─── PaymentsModule ──────── CommissionsModule
MaintenanceModule
NotificationsModule (QueueModule, PrismaModule)
MessagesModule
DocumentsModule (reports)
DashboardModule ← PropertiesModule
ApplicationsModule
```

---

## 2. Schéma Prisma

### Enums clés

```
Role                : ADMIN | OWNER | MANAGER | TENANT | VISITOR
PropertyType        : APARTMENT | VILLA | OFFICE | HOUSE | LAND | COMMERCIAL | BUILDING
PropertyStatus      : AVAILABLE | RENTED | MAINTENANCE | RESERVED
ContractStatus      : ACTIVE | EXPIRED | TERMINATED | RENEWAL
PaymentStatus       : PAID | PENDING | LATE | CANCELLED
PaymentMethod       : MOBILE_MONEY | TRANSFER | CASH | CARD
ApplicationStatus   : PENDING | ACCEPTED | REJECTED
MaintenanceUrgency  : LOW | NORMAL | HIGH | CRITICAL
MaintenanceStatus   : OPEN | IN_PROGRESS | RESOLVED | CLOSED
NotificationChannel : EMAIL | SMS | BOTH
AgencyStatus        : ACTIVE | SUSPENDED
AgencyMemberRole    : MEMBER | ADMIN
MandateStatus       : ACTIVE | TERMINATED | EXPIRED
CommissionType      : PERCENTAGE | FIXED
CommissionCategory  : PLACEMENT | MANAGEMENT | EXCEPTIONAL
CommissionStatus    : PENDING | PAID | CANCELLED
```

### Relations clés

| Modèle | Rôle | Relations |
|---|---|---|
| `User` | Racine | Possède/gère des propriétés, notifications, refresh tokens, OTP |
| `Property` | Bien | Appartient à owner + manager optionnel ; images, documents, contrats |
| `Tenant` | Locataire | Lié à User optionnel ; contrats, paiements, candidatures |
| `Contract` | Contrat | Lie Property + Tenant ; clauses, paiements, commissions |
| `Payment` | Paiement | Lié à Contract + Tenant + Property ; déclenche des commissions |
| `Application` | Candidature | Soumission publique pour une propriété |
| `MaintenanceRequest` | Maintenance | Property + tenant optionnel ; cycle ouvert/fermé |
| `Agency` | Agence | Membres (AgencyMember), mandats, commissions |
| `Mandate` | Mandat | Agency + Manager gèrent une propriété |
| `Commission` | Commission | Liée à Mandate + Contract + Agency ; auto-générée à chaque paiement |

### Observations schéma

- `passwordHash` en `VarChar(255)` — bcrypt fait ~60 chars, OK
- `Decimal` utilisé sur `latitude`, `longitude`, `area`, `commissionValue` — précision correcte
- Champs `JSON` (`emailPrefs`, `smsPrefs`, `params`) — nécessitent validation côté service
- `deletedAt` présent sur les entités principales — soft-delete cohérent

---

## 3. Audit module par module

---

### 3.1 app

**Fichiers** : `app.module.ts`, `app.controller.ts`, `main.ts`

#### Routes
| Méthode | Path | Auth |
|---|---|---|
| `GET` | `/` | Public |

#### Config globale
- `ThrottlerGuard` : 200 req / 60 s — généreux, peut ne pas prévenir l'abus
- `EventEmitter` : `wildcard: true` — peut provoquer des correspondances d'événements involontaires

#### Problèmes
- ⚠️ **Pas d'endpoint `/health`** : absence de healthcheck pour load balancers
- ⚠️ **Pas de graceful shutdown** : `app.enableShutdownHooks()` manquant

---

### 3.2 auth

**Fichiers** : `auth.module.ts`, `auth.controller.ts`, `auth.service.ts`, `strategies/jwt.strategy.ts`, `dto/`

#### Routes
| Méthode | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/auth/register` | Public | Rôles autorisés : OWNER ou TENANT uniquement |
| `POST` | `/auth/verify-email` | Public | OTP 6 chiffres |
| `POST` | `/auth/resend-otp` | Public | Limité à 3 tentatives/10 min |
| `POST` | `/auth/login` | Public | Email + mot de passe |
| `POST` | `/auth/refresh` | Public | Rotation du refresh token |
| `POST` | `/auth/forgot-password` | Public | Réponse générique (anti-timing) |
| `POST` | `/auth/reset-password` | Public | Token UUID |
| `PATCH` | `/auth/change-password` | JWT | Nécessite l'ancien mot de passe |
| `POST` | `/auth/logout` | JWT | Révoque le refresh token |

#### Problèmes
- 🔴 **OTP et liens de reset loggés en console** — les tokens apparaissent dans les logs serveur/Sentry
- ⚠️ **Pas de normalisation de l'email** — login `User@Example.com` ≠ `user@example.com`
- ⚠️ **Refresh token : pas de vérification "déjà utilisé"** — révoque l'ancien mais ne détecte pas le rejeu
- ⚠️ **Token de reset = UUID simple** — pas de signature HMAC ; l'expiration est dans la DB, pas dans le token
- ⚠️ **Pas d'empreinte device** — refresh tokens valides 30 j sans contrainte de device

#### Points positifs
- ✓ Bcrypt coût 12
- ✓ Expiration OTP 15 min
- ✓ Réponse générique sur forgot-password (protection timing)

#### Tests
- Aucun fichier `.spec.ts` pour `auth.service.ts` ❌

---

### 3.3 users

**Fichiers** : `users.module.ts`, `users.controller.ts`, `users.service.ts`, `user.repository.ts`, `dto/update-user.dto.ts`

#### Routes
| Méthode | Path | Rôles | Description |
|---|---|---|---|
| `GET` | `/users/me` | JWT | Profil courant |
| `PATCH` | `/users/me` | JWT | Mise à jour nom/téléphone |
| `POST` | `/users/me/avatar` | JWT | Upload avatar (multipart) |
| `POST` | `/users/search` | ADMIN | Liste paginée |
| `GET` | `/users/:id/detail` | JWT | Détail d'un utilisateur |
| `PATCH` | `/users/:id/update` | ADMIN | Mise à jour rôle/statut |
| `DELETE` | `/users/:id` | ADMIN | Soft-delete (isActive=false) |
| `POST` | `/users/:ownerId/delegations` | OWNER | Déléguer des biens à un manager |
| `DELETE` | `/users/:ownerId/delegations/:managerId` | OWNER | Révoquer une délégation |

#### `USER_SELECT`
`passwordHash` exclu de toutes les projections — bonne pratique.

#### Problèmes
- ⚠️ **Regex téléphone Cameroun uniquement** : `+237[0-9]{8,9}` — bloque l'internationalisation
- ⚠️ **Délégation sans vérification que le manager est actif**
- ⚠️ **`as never` dans `tenants.service.ts:36`** — contournement de type

#### Tests
- Aucun fichier `.spec.ts` pour `users.service.ts` ou `user.repository.ts` ❌

---

### 3.4 admin

**Fichiers** : `admin.module.ts`, `admin.controller.ts`, `admin.service.ts`

#### Routes (tous `@Roles(Role.ADMIN)`)
| Méthode | Path | Description |
|---|---|---|
| `GET` | `/admin/stats` | KPIs plateforme |
| `GET` | `/admin/settings` | Paramètres système |
| `PUT` | `/admin/settings` | Mise à jour paramètres |
| `GET` | `/admin/users` | Liste utilisateurs filtrée |
| `PATCH` | `/admin/users/:id/deactivate` | Désactiver un utilisateur |

#### Problèmes
- ⚠️ **`updateSettings()` prend `body: any`** — aucune validation ; n'importe quel champ accepté
- ⚠️ **AdminSettings sans verrou optimiste** — mises à jour concurrentes peuvent se perdre
- ⚠️ **Volume paiements sans filtre de date** — somme tous les PAID depuis toujours
- ⚠️ **Pas d'audit log** — qui a changé quoi, quand ?

#### Tests
- `admin.service.spec.ts` présent ✓

---

### 3.5 agencies

**Fichiers** : `agencies.module.ts`, `agencies.controller.ts`, `agencies.service.ts`, `dto/agency.dto.ts`

#### Routes
| Méthode | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/agencies` | ADMIN | Créer une agence |
| `PATCH` | `/agencies/:id/suspend` | ADMIN | Suspendre |
| `GET` | `/agencies` | ADMIN | Liste paginée |
| `POST` | `/agencies/:id/members` | (service) | Ajouter membre (ADMIN ou admin agence) |
| `DELETE` | `/agencies/:id/members/:memberId` | **AUCUN** | Supprimer membre ⚠️ |
| `GET` | `/agencies/:id/public` | Public | Profil public (cache 1800 s) |

#### Problèmes
- 🔴 **`DELETE /agencies/:id/members/:memberId` n'a pas de `@Roles`** — n'importe qui peut supprimer un membre si l'ID est connu
- ⚠️ **Invalidation du cache manquante** — ajout/suppression de membre ne vide pas le cache public
- ⚠️ **Email et téléphone non uniques** — plusieurs agences peuvent partager le même email

#### Tests
- `agencies.service.spec.ts` présent ✓

---

### 3.6 properties

**Fichiers** : `properties.module.ts`, `properties.controller.ts`, `properties.service.ts`, `property.repository.ts`, `dto/`

#### Routes
| Méthode | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/properties` | Public | Liste publiée (cache 300 s) |
| `GET` | `/properties/:slug` | Public | Détail par slug (cache) |
| `GET` | `/properties/dashboard/list` | OWNER\|MGR\|ADMIN | Liste de gestion |
| `POST` | `/properties` | OWNER\|MGR\|ADMIN | Créer |
| `PATCH` | `/properties/:id` | OWNER\|MGR\|ADMIN | Modifier |
| `PATCH` | `/properties/:id/publish` | OWNER\|MGR\|ADMIN | Publier (≥1 image requise) |
| `PATCH` | `/properties/:id/status` | OWNER\|MGR\|ADMIN | Changer statut |
| `DELETE` | `/properties/:id` | OWNER\|MGR\|ADMIN | Soft-delete |
| `POST` | `/properties/:id/images` | OWNER\|MGR\|ADMIN | Upload images (max 4) |
| `PATCH` | `/properties/:id/images/:imageId/cover` | OWNER\|MGR\|ADMIN | Définir la couverture |
| `DELETE` | `/properties/:id/images/:imageId` | OWNER\|MGR\|ADMIN | Supprimer image |
| `POST` | `/properties/:id/documents` | OWNER\|MGR\|ADMIN | Upload documents (max 10) |

#### Problèmes
- 🔴 **URLs S3 en placeholder** : `https://placeholder/...` dans le contrôleur — images non stockées réellement
- ⚠️ **Collision de slug** : `slugify(title)-${uuid.substring(0,8)}` — très rare mais théoriquement possible
- ⚠️ **Pas de transaction** sur création propriété + images
- ⚠️ **Pas de validation de taille/type** sur les uploads

#### Points positifs
- ✓ Vérifications de propriété exhaustives
- ✓ Invalidation cache sur mutations
- ✓ Soft-delete cohérent (`deletedAt=null`)

#### Tests
- `properties.service.spec.ts` présent ✓

---

### 3.7 tenants

**Fichiers** : `tenants.module.ts`, `tenants.controller.ts`, `tenants.service.ts`, `tenant.repository.ts`, `dto/tenant.dto.ts`

#### Routes
| Méthode | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/tenants` | OWNER\|MGR\|ADMIN | Liste (scopée par rôle) |
| `POST` | `/tenants` | OWNER\|MANAGER | Créer locataire |
| `GET` | `/tenants/me/payments` | TENANT | Voir ses paiements |
| `GET` | `/tenants/:id` | OWNER\|MGR\|ADMIN | Détail (vérification propriété) |
| `PATCH` | `/tenants/:id` | OWNER\|MGR | Modifier |
| `POST` | `/properties/:slug/applications` | Public | Soumettre candidature |
| `GET` | `/properties/:id/applications` | OWNER\|MGR\|ADMIN | Liste candidatures |
| `PATCH` | `/properties/:id/applications/:appId` | OWNER\|MGR\|ADMIN | Mettre à jour statut |

#### Problèmes
- ⚠️ **`as never` dans `getById()` (ligne 36)** — contournement de type dangereux
- ⚠️ **Application sans `tenantId`** : `firstName`/`lastName`/`email` tombent en chaîne vide
- ⚠️ **`nationalIdNumber` stocké sans validation** — format arbitraire accepté
- ⚠️ **Pas de contrainte unicité (email, propertyId)** sur les candidatures — doublons possibles
- ⚠️ **`income` en `Int`** — pas de borne min/max

#### Tests
- `tenants.service.spec.ts` présent ✓

---

### 3.8 applications

**Fichiers** : `applications.module.ts`, `applications.controller.ts`, `applications.service.ts`

#### Routes
| Méthode | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/applications` | Public | Soumettre candidature publique |
| `GET` | `/applications` | OWNER\|MGR\|ADMIN | Liste (propertyId en query) |
| `PATCH` | `/applications/:id/accept` | OWNER\|MGR\|ADMIN | Accepter |
| `PATCH` | `/applications/:id/reject` | OWNER\|MGR\|ADMIN | Rejeter |

#### Problèmes
- ⚠️ **Pas de CAPTCHA** sur la route publique — risque de spam
- ⚠️ **`propertyId` en query param** (`GET /applications?propertyId=`) — viole la convention REST, devrait être en path param
- ⚠️ **Aucune validation de l'email** de l'applicant (format uniquement vérifié par `IsEmail`)

#### Tests
- `applications.service.spec.ts` présent ✓

---

### 3.9 mandates

**Fichiers** : `mandates.module.ts`, `mandates.controller.ts`, `mandates.service.ts`, `mandate.repository.ts`, `dto/mandate.dto.ts`

#### Routes
| Méthode | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/mandates` | OWNER\|ADMIN | Créer mandat |
| `POST` | `/mandates/:id/terminate` | OWNER\|ADMIN | Terminer |
| `GET` | `/mandates` | JWT | Liste (scopée) |

#### Problèmes
- ⚠️ **Module `@Global()`** — exporte `MandateRepository` globalement ; couplage fort
- ⚠️ **Duplication `Property.managerId`** — Mandate ET Property trackent le manager ; désynchronisation possible
- ⚠️ **`endDate` optionnel** — peut être dans le passé sans erreur
- ⚠️ **`commissionType`/`commissionValue` optionnels sans co-validation** — l'un sans l'autre crée des incohérences

#### Points positifs
- ✓ Validation `AgencyMember` — le manager doit appartenir à l'agence
- ✓ `MandateGuard` disponible globalement

#### Tests
- `mandates.service.spec.ts` + `mandate.guard.spec.ts` + `mandate.repository.spec.ts` ✓

---

### 3.10 contracts

**Fichiers** : `contracts.module.ts`, `contracts.controller.ts`, `contracts.service.ts`, `contract.repository.ts`, `dto/contract.dto.ts`

#### Routes
| Méthode | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/contracts` | JWT | Liste (scopée) |
| `POST` | `/contracts` | OWNER\|MGR\|ADMIN | Créer |
| `GET` | `/contracts/:id` | JWT | Détail |
| `POST` | `/contracts/:id/renewal` | OWNER\|MGR\|ADMIN | Renouveler |
| `POST` | `/contracts/:id/termination` | OWNER\|MGR\|ADMIN | Résilier |
| `GET` | `/contracts/:id/pdf` | JWT | URL PDF (force régénération) |
| `POST` | `/contracts/:id/receipts` | JWT | Générer quittances PDF |

#### Flux de création
Transactionnel (UnitOfWork) : créer contrat → mettre propriété à RENTED → générer échéancier de paiements → notifier locataire

#### Problèmes
- ⚠️ **`TVA_RATE` hardcodée** — doit venir d'`AdminSettings`
- ⚠️ **Pas de validation `startDate < endDate`** — contrats à dates inversées acceptés
- ⚠️ **Renouvellement ne copie pas les clauses du parent**
- ⚠️ **Opérations PDF potentiellement bloquantes** — `PdfService` non audité

#### Points positifs
- ✓ Transactions ACID via `UnitOfWorkService`
- ✓ Génération automatique de l'échéancier

#### Tests
- `contracts.service.spec.ts` présent ✓

---

### 3.11 payments

**Fichiers** : `payments.module.ts`, `payments.controller.ts`, `payments.service.ts`, `payment.repository.ts`, `dto/payment.dto.ts`

#### Routes
| Méthode | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/payments` | JWT | Liste (scopée) |
| `POST` | `/payments` | OWNER\|MGR\|ADMIN | Enregistrer paiement |
| `PATCH` | `/payments/:id` | OWNER\|MGR\|ADMIN | Modifier |
| `GET` | `/payments/overdue` | JWT | Résumé impayés |
| `POST` | `/payments/reminders` | OWNER\|MGR\|ADMIN | Envoyer rappels |
| `GET` | `/payments/stats` | JWT | Statistiques |
| `GET` | `/payments/:id/receipt` | JWT | URL reçu signé |

#### Génération de commissions
Quand un paiement est marqué `PAID` → commissions créées pour tous les mandats actifs selon `commissionType` (PERCENTAGE ou FIXED) avec application de la TVA.

#### Problèmes
- ⚠️ **`TVA_RATE` hardcodée** — même problème que contracts
- ⚠️ **Pas de validation `amount > 0`** — paiements à zéro acceptés
- ⚠️ **Pas de contrainte d'unicité `(contractId, period)`** en base — doublons de paiements possibles
- ⚠️ **Logique d'autorisation dans `create()` convoluted** — `as never` + try/catch pour simuler un guard

#### Tests
- `payments.service.spec.ts` présent ✓

---

### 3.12 maintenance

**Fichiers** : `maintenance.module.ts`, `maintenance.controller.ts`, `maintenance.service.ts`, `dto/maintenance.dto.ts`

#### Routes
| Méthode | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/maintenance` | TENANT\|OWNER\|MGR\|ADMIN | Créer demande |
| `GET` | `/maintenance/my-requests` | TENANT | Voir ses demandes |
| `GET` | `/maintenance` | OWNER\|MGR\|ADMIN | Liste |
| `PATCH` | `/maintenance/:id/status` | JWT | Mettre à jour statut |
| `POST` | `/maintenance/:id/photos` | JWT | Upload photos (max 3) |

#### Machine d'état des statuts

```
OPEN → IN_PROGRESS → RESOLVED → CLOSED
                             └→ OPEN (réouverture TENANT)
```

Transitions :
- `IN_PROGRESS` / `RESOLVED` : OWNER | MANAGER | ADMIN
- `CLOSED` / `OPEN` (réouverture) : TENANT | ADMIN

#### Problèmes
- 🔴 **Photos stockées en placeholder** — `maintenance.controller.ts` n'appelle pas `StorageService`
- ⚠️ **Pas de limite de taille** sur `FilesInterceptor`
- ⚠️ **`images` en `String[]`** dans le schéma — stocke des URLs ou des clés S3 ?

#### Points positifs
- ✓ Vérification de rôle complète à la création (TENANT vérifie contrat actif, MANAGER vérifie mandat)
- ✓ Notification spéciale pour urgence CRITICAL

#### Tests
- `maintenance.service.spec.ts` présent ✓

---

### 3.13 commissions

**Fichiers** : `commissions.module.ts`, `commissions.controller.ts`, `commissions.service.ts`, `commission.repository.ts`, `dto/commission.dto.ts`

#### Routes
| Méthode | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/commissions/dashboard` | MGR\|ADMIN | KPIs commissions |
| `GET` | `/commissions/my-due` | OWNER | Commissions dues à l'owner |
| `GET` | `/commissions` | MGR\|ADMIN | Liste |
| `POST` | `/commissions` | MGR\|ADMIN | Commission manuelle |
| `POST` | `/commissions/:id/pay` | OWNER\|ADMIN | Marquer payé |
| `POST` | `/commissions/:id/cancel` | OWNER\|ADMIN | Annuler (si PENDING) |

#### Problèmes
- ⚠️ **Calcul TVA inline** — devrait être une fonction utilitaire partagée
- ⚠️ **Pas de validation `amount > 0`** — commission nulle ou négative acceptée
- ⚠️ **Type `WithRelations` complexe défini inline** — manque de lisibilité

#### Tests
- `commissions.service.spec.ts` présent ✓

---

### 3.14 messages

**Fichiers** : `messages.module.ts`, `messages.controller.ts`, `messages.service.ts`, `message.repository.ts`

#### Routes
| Méthode | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/messages/conversations` | JWT | Liste des conversations |
| `GET` | `/messages/:userId` | JWT | Messages avec un utilisateur |
| `POST` | `/messages` | JWT | Envoyer message |
| `PATCH` | `/messages/:conversationUserId/read` | JWT | Marquer lu |
| `POST` | `/messages/attachments` | JWT | Upload pièce jointe (placeholder) |

#### Problèmes
- ⚠️ **`as never` dans `getConversations()` (lignes 30-34)** — extraction des infos de contact par coercition de type
- ⚠️ **Messages en clair** — pas de chiffrement
- ⚠️ **Pas de rate limiting par utilisateur** — spam possible
- ⚠️ **Upload de pièces jointes non implémenté** — placeholder
- ⚠️ **Pas de suppression de messages** — visibles indéfiniment

#### Tests
- Aucun fichier `.spec.ts` ❌

---

### 3.15 notifications

**Fichiers** : `notifications.module.ts`, `notifications.controller.ts`, `notifications.service.ts`, `email-queue.service.ts`, `notifications.processor.ts`, `notification.repository.ts`

#### Routes
| Méthode | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/notifications` | JWT | Liste paginée |
| `GET` | `/notifications/count` | JWT | Compteur non lus |
| `PATCH` | `/notifications/read-all` | JWT | Tout marquer lu |
| `PATCH` | `/notifications/:id/read` | JWT | Marquer un lu |
| `GET` | `/notifications/preferences` | JWT | Préférences |
| `PUT` | `/notifications/preferences` | JWT | Mettre à jour préférences |
| `PUT` | `/notifications/payment-alerts` | JWT | Config alertes paiement |

#### Architecture queue

```
Service → EmailQueueService.sendEmail()
       → BullMQ Queue "notifications"
       → NotificationsProcessor.process()
       → Nodemailer (SMTP)
```

Retry : 3 tentatives, backoff exponentiel.

#### Problèmes
- ⚠️ **Templates email = tableau HTML brut** — pas de CSS, pas de branding, mauvaise expérience
- ⚠️ **Préférences stockées en JSON** — validation de schéma absente
- ⚠️ **Pas de Dead Letter Queue** — jobs définitivement perdus après 3 échecs
- ⚠️ **`NotificationsProcessor` (`@Processor`)** se connecte à Redis à l'initialisation — désactivé conditionnellement quand `REDIS_ENABLED=false`

#### Tests
- `email-queue.service.spec.ts` ✓
- `notifications.processor.spec.ts` ✓ (Worker BullMQ mocké)
- `notifications.service.ts` : aucun test ❌

---

### 3.16 documents (reports)

**Fichiers** : `documents.module.ts`, `documents.controller.ts`, `documents.service.ts`

#### Routes (préfixe `/reports`)
| Méthode | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/reports/financial` | OWNER\|MGR\|ADMIN | Rapport financier |
| `GET` | `/reports/occupancy` | JWT | Taux d'occupation |
| `POST` | `/reports/export` | JWT | Export PDF (asynchrone) |
| `GET` | `/reports/export/:jobId` | JWT | Statut de l'export |
| `GET` | `/reports/profitability/:propertyId` | OWNER\|MGR\|ADMIN | Rentabilité |

#### Problèmes
- ⚠️ **Calcul des charges (`fees`) hardcodé à 0** — TODO explicite
- ⚠️ **`const propertyWhere: any`** — pas de type safety
- ⚠️ **Export PDF non enqueuté** — `createExportJob()` crée un `ReportJob` mais ne lance pas la génération
- ⚠️ **ROI non calculé** — TODO explicite
- ⚠️ **Aucun cache** sur les rapports — coûteux à recalculer

#### Tests
- `documents.service.spec.ts` présent ✓

---

### 3.17 dashboard

**Fichiers** : `dashboard.module.ts`, `dashboard.controller.ts`, `dashboard.service.ts`

#### Routes
| Méthode | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/dashboard/portfolio` | OWNER\|MGR\|ADMIN | KPIs occupancy/revenus |
| `GET` | `/dashboard/maintenance` | OWNER\|MGR\|ADMIN | KPIs maintenance |
| `GET` | `/dashboard/commissions` | MANAGER | KPIs commissions |
| `GET` | `/dashboard/admin` | ADMIN | Stats plateforme |
| `GET` | `/dashboard/tenant` | TENANT | Vue locataire |
| `GET` | `/dashboard/properties` | JWT | Liste biens (délégue à PropertiesService) |
| `GET` | `/maintenance-requests` | OWNER\|MGR\|ADMIN | Liste demandes |
| `POST` | `/maintenance-requests` | TENANT\|OWNER\|MGR\|ADMIN | Créer demande |
| `PATCH` | `/maintenance-requests/:id` | JWT | Modifier |

#### Problèmes
- ⚠️ **Plusieurs `as never` et spread sans typage** (lignes 32-33, 56-65)
- ⚠️ **`DashboardModule` importe `PropertiesModule`** — crée un couplage fort
- ⚠️ **Stratégie d'invalidation du cache non claire** — `CacheService` utilisé mais TTL variable

#### Tests
- `dashboard.service.spec.ts` présent — 20 tests ✓

---

### 3.18 queue & cron

**Fichiers** : `queue/queue.module.ts`, `queue/cron.module.ts`, `queue/cron.service.ts`

#### QueueModule

Quatre queues BullMQ : `pdf`, `email`, `sms`, `notifications`.

Mode `REDIS_ENABLED=false` : providers no-op pour tous les tokens — aucune connexion Redis, `add()` devient no-op.

#### CronService (tâches nocturnes)

| Cron | Heure | Action |
|---|---|---|
| `markLatePayments` | 00:01 | PENDING → LATE si dueDate < maintenant |
| `expireContracts` | 00:05 | Expire les contrats, libère le bien, annule les paiements |
| `sendLeaseExpiryAlerts` | 00:10 | Alertes renouvellement 7/15/30 j avant |

#### Problèmes
- ⚠️ **Queue SMS non consommée** — `SMS_QUEUE` enregistrée mais pas de processor
- ⚠️ **Queue PDF non utilisée** — enregistrée mais jamais appelée dans les services
- ⚠️ **Horaires cron hardcodés** — non configurables via variable d'environnement
- ⚠️ **Pas de gestion d'erreur dans les cron jobs** — échec silencieux

#### Tests
- `cron.service.spec.ts` présent ✓

---

### 3.19 cache

**Fichiers** : `cache/cache.module.ts`, `cache/cache.service.ts`

#### Interface

```typescript
get<T>(key): Promise<T | null>
set(key, value, ttl = 300): Promise<void>
del(key): Promise<void>
delByPrefix(prefix): Promise<void>
```

#### Comportement sans Redis
`lazyConnect: true`, `retryStrategy: () => null`, flag `available = false` → dégradation gracieuse, toutes les méthodes retournent `null` ou no-op.

#### Problèmes
- ⚠️ **`maxRetriesPerRequest: 1`** — très agressif
- ⚠️ **`delByPrefix()` non atomique** — race condition possible entre `KEYS` et `DEL`
- ⚠️ **Erreurs silencieusement supprimées** — `catch { /* no-op */ }`

#### Tests
- Aucun fichier `.spec.ts` ❌

---

### 3.20 storage

**Fichiers** : `storage/storage.module.ts`, `storage/storage.service.ts`

#### Interface

```typescript
uploadBuffer(key, buffer, mimeType): Promise<string>   // retourne URL publique
delete(key): Promise<void>
getSignedUrl(key, expiresIn = 900): Promise<string>
keyFromUrl(url): string
generateKey(...parts): string
generateId(): string                                    // UUID v4
```

#### Problèmes
- ⚠️ **Pas de validation de taille** — n'importe quelle taille acceptée
- ⚠️ **Pas de validation MIME** — n'importe quel type accepté
- ⚠️ **`delete()` ne lève pas d'exception** — erreurs loggées puis ignorées
- ⚠️ **URL signée expirée en 15 min (900 s)** — peut être trop court pour certains cas d'usage
- ⚠️ **Pas de retry** — un seul essai d'upload

#### Tests
- Aucun fichier `.spec.ts` ❌

---

### 3.21 prisma

**Fichiers** : `prisma/prisma.module.ts`, `prisma/prisma.service.ts`

`PrismaService extends PrismaClient` avec l'adaptateur `PrismaPg` (driver natif PostgreSQL, plus rapide que le driver JS par défaut).

#### Problèmes
- ⚠️ **`DATABASE_URL` sans fallback** — crash si variable absente
- ⚠️ **Pool de connexions non configuré** — valeurs PrismaPg par défaut
- ⚠️ **Pas de timeout de transaction**

---

### 3.22 common / infrastructure

#### Guards

| Guard | Comportement |
|---|---|
| `JwtAuthGuard` | Vérifie `@Public()` ; sinon exige JWT Passport |
| `RolesGuard` | Vérifie `@Roles(...)` ; passe si aucun rôle requis |
| `MandateGuard` | Pour MANAGER : vérifie mandat actif pour `propertyId` |

#### Décorateurs

`@Public()`, `@Roles(...Role[])`, `@CurrentUser()`, `@Cacheable(key, ttl)`, `@CacheEvict(key)`

#### Interceptors

| Interceptor | Rôle |
|---|---|
| `TransformInterceptor` | Enveloppe toutes les réponses en `{ data, statusCode, timestamp }` |
| `LoggingInterceptor` | Log req/res |
| `CacheInterceptor` | Sert depuis le cache avant d'appeler le handler |

#### Abstractions

- `BaseRepository<T, D>` : `findById`, `findByIdOrThrow`, `create`, `update`, `delete`, `findAll`, `buildSearchWhere`, `buildSearchOrderBy`
- `BaseService<T, D>` : wrapper léger autour du repository
- `IService<T, D>` : interface commune (CRUD)
- `IRepository<T, D>` : interface commune

#### Problèmes
- ⚠️ **`TransformInterceptor` enveloppe aussi les erreurs** — incohérence dans le format des réponses d'erreur
- ⚠️ **`ThrottlerGuard` global, pas par utilisateur** — un utilisateur abuseur consomme le quota de tous
- ⚠️ **`MandateGuard` cherche `propertyId` dans `params` puis `body`** — pas prévu pour les cas où c'est dans la query string

#### Tests
- `mandate.guard.spec.ts` ✓
- `domain-event.base.spec.ts` ✓
- `event-emitter.spec.ts` ✓
- `pdf.service.spec.ts` ✓

---

## 4. Problèmes critiques & sécurité

### 🔴 CRITIQUE

| # | Problème | Localisation | Impact |
|---|---|---|---|
| C1 | OTP et liens de reset loggés en console | `auth.service.ts` | Tokens exposés dans logs/Sentry |
| C2 | `DELETE /agencies/:id/members/:memberId` sans `@Roles` | `agencies.controller.ts` | N'importe qui peut supprimer un membre |
| C3 | Upload de fichiers sans validation de taille ni de type MIME | Tous les contrôleurs avec `FileInterceptor` | DoS (gros fichiers), upload de malware |
| C4 | URLs S3 en placeholder dans le contrôleur | `properties.controller.ts`, `maintenance.controller.ts` | Images/documents non stockés réellement |

### 🟠 ÉLEVÉ

| # | Problème | Localisation | Impact |
|---|---|---|---|
| H1 | `TVA_RATE` hardcodée (19.25 %) | `contracts.service.ts`, `commissions.service.ts` | Nécessite redéploiement pour changer le taux |
| H2 | Templates email = tableau HTML sans CSS | `notifications.processor.ts` | Mauvaise expérience utilisateur, pas de branding |
| H3 | Pas de CAPTCHA sur les routes publiques | `/applications`, `/tenants/:slug/applications` | Spam, DoS |
| H4 | Casts `as never` et `as any` | `tenants.service.ts`, `messages.service.ts`, `dashboard.service.ts`, `documents.service.ts` | Contournement du système de types, erreurs runtime possibles |
| H5 | Pas de normalisation de l'email à la connexion | `auth.service.ts` | `User@Example.com` ≠ `user@example.com` |
| H6 | Contrainte d'unicité `(contractId, period)` manquante en base | Schéma Prisma | Paiements doublons possibles |

### 🟡 MOYEN

| # | Problème | Impact |
|---|---|---|
| M1 | Pas de niveau d'isolation de transaction spécifié | Lectures fantômes possibles |
| M2 | Pas de Dead Letter Queue pour les emails | Perte définitive des jobs après 3 échecs |
| M3 | Validation téléphone uniquement Cameroun (`+237...`) | Internationalisation bloquée |
| M4 | Pagination offset (pas cursor) | Inefficace sur grands datasets |
| M5 | `AdminSettings` sans audit log | Impossible de savoir qui a changé quoi |
| M6 | Queue PDF et SMS enregistrées mais non consommées | Code mort trompeur |
| M7 | `delByPrefix()` non atomique | Race condition possible |
| M8 | Pas de validation `startDate < endDate` dans les contrats | Contrats à dates inversées acceptés |
| M9 | `updateSettings()` accepte `body: any` | Injection de champs arbitraires |
| M10 | `commissionType`/`commissionValue` sans co-validation | Mandat incohérent (type sans valeur) |

---

## 5. Implémentations manquantes

### TODO explicites dans le code

| Localisation | TODO |
|---|---|
| `auth.service.ts:68` | Envoi OTP/reset par email/SMS (actuellement `console.log`) |
| `properties.controller.ts:125` | Appel réel à `StorageService.uploadBuffer()` pour les images |
| `maintenance.controller.ts:82` | Appel réel à `StorageService` pour les photos |
| `messages.controller.ts:62` | Upload de pièces jointes |
| `documents.service.ts:105` | Enqueue de la génération PDF dans le job |
| `documents.service.ts:135` | Calcul du ROI |
| `documents.service.ts:38` | Calcul des charges (`fees`) |

### Lacunes implicites

- Pas de WebSocket pour les notifications en temps réel
- Pas d'intégration SMS (opérateur mobile money)
- Pas de journalisation d'audit (qui a fait quoi)
- Pas de politique de rétention des données
- Pas d'export/suppression RGPD
- Pas de 2FA (au-delà de l'OTP à l'inscription)
- Pas de clés idempotentes sur les paiements
- Pas d'IP whitelisting sur les routes admin
- Pas de versioning d'API (`/api/v1/...`)
- Pas de healthcheck endpoint (`/health`)

---

## 6. Couverture de tests

### Tests présents (20 suites, 221 tests)

| Fichier | Présent |
|---|---|
| `admin.service.spec.ts` | ✓ |
| `agencies.service.spec.ts` | ✓ |
| `applications.service.spec.ts` | ✓ |
| `contracts.service.spec.ts` | ✓ |
| `payments.service.spec.ts` | ✓ |
| `maintenance.service.spec.ts` | ✓ |
| `tenants.service.spec.ts` | ✓ |
| `properties.service.spec.ts` | ✓ |
| `dashboard.service.spec.ts` | ✓ (20 tests) |
| `commissions.service.spec.ts` | ✓ |
| `mandates.service.spec.ts` | ✓ |
| `cron.service.spec.ts` | ✓ |
| `mandate.guard.spec.ts` | ✓ |
| `mandate.repository.spec.ts` | ✓ |
| `email-queue.service.spec.ts` | ✓ |
| `notifications.processor.spec.ts` | ✓ |
| `domain-event.base.spec.ts` | ✓ |
| `event-emitter.spec.ts` | ✓ |
| `pdf.service.spec.ts` | ✓ |
| `app.controller.spec.ts` | ✓ |

### Tests manquants (critique)

| Fichier | Priorité |
|---|---|
| `auth.service.ts` | 🔴 CRITIQUE |
| `users.service.ts` | 🟠 ÉLEVÉ |
| `messages.service.ts` | 🟡 MOYEN |
| `notifications.service.ts` | 🟡 MOYEN |
| `cache.service.ts` | 🟡 MOYEN |
| `storage.service.ts` | 🟡 MOYEN |
| Tous les contrôleurs | 🟡 MOYEN |

### Tests d'intégration manquants

1. Inscription → vérification email → connexion → mise à jour profil
2. Création propriété → upload image → publication → accès public slug
3. Soumission candidature → acceptation → création locataire → contrat → paiement
4. Paiement PAID → génération commission → paiement commission

---

## 7. Recommandations & roadmap

### Immédiat (à faire avant toute mise en production)

1. **[C1]** Remplacer `console.log(otp)` par un vrai envoi email/SMS
2. **[C2]** Ajouter `@Roles(Role.ADMIN)` sur `DELETE /agencies/:id/members/:memberId`
3. **[C3]** Ajouter `limits: { fileSize: 5 * 1024 * 1024 }` et whitelist MIME dans tous les `FileInterceptor`
4. **[C4]** Implémenter `StorageService.uploadBuffer()` dans les contrôleurs de biens et maintenance
5. **[H5]** Normaliser l'email en minuscule avant toute recherche

### Court terme (1-2 semaines)

1. **[H1]** Déplacer `TVA_RATE` dans `AdminSettings`
2. **[H2]** Intégrer Handlebars pour les templates email
3. **[H3]** Ajouter reCAPTCHA v3 sur les routes publiques
4. **[H4]** Remplacer tous les `as never` / `as any` par des types corrects
5. **[H6]** Ajouter contrainte unique `(contractId, period)` dans le schéma Prisma
6. Écrire les tests pour `auth.service.ts`
7. Ajouter un endpoint `/health`

### Moyen terme (1 mois)

1. Implémenter les TODO restants (photos, PDF export, ROI, fees)
2. WebSocket pour les notifications temps réel
3. Intégration SMS (Orange Money, MTN)
4. Table `AuditLog` + middleware
5. Endpoint RGPD (export + suppression)
6. Pagination cursor-based pour les grandes collections
7. Profiler les requêtes Prisma + ajouter des index manquants

### Long terme (trimestre)

1. Versioning API (`/api/v1/`)
2. Authentification OAuth2 (mobile, PKCE)
3. Export CSV des rapports
4. 2FA optionnel (TOTP)
5. Support multi-pays (téléphone, devise)

---

## Résumé exécutif

| Dimension | Évaluation |
|---|---|
| Architecture | ✅ Bien structurée (modules cohérents, abstractions solides) |
| Sécurité | ⚠️ Lacunes critiques (logs OTP, route sans auth, uploads non validés) |
| Qualité du code | ⚠️ Casts de type répandus, TODO non résolus |
| Tests | ⚠️ Couverture partielle — services critiques (auth) non testés |
| Production-readiness | ❌ Non prêt — 4 bloquants critiques à traiter |

**Niveau de risque global : MOYEN-ÉLEVÉ** — MVP techniquement fonctionnel, mais nécessite une passe de hardening sécurité et la résolution des TODO avant de passer en production avec de vrais utilisateurs.
