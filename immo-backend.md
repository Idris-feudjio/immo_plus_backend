# Cahier des Charges Fonctionnel — Backend Immo Plus CM

> **Version :** 1.0  
> **Date :** 2026-05-26  
> **Destinataires :** Équipe Backend  
> **Statut :** Document de référence

---

## Table des matières

1. [Présentation générale](#1-présentation-générale)
2. [Acteurs et permissions](#2-acteurs-et-permissions)
3. [Architecture technique recommandée](#3-architecture-technique-recommandée)
4. [Modèles de données](#4-modèles-de-données)
5. [Module Authentification](#5-module-authentification)
6. [Module Utilisateurs](#6-module-utilisateurs)
7. [Module Properties](#7-module-properties)
8. [Module Tenants](#8-module-tenants)
9. [Module Contracts](#9-module-contracts)
10. [Module Payments](#10-module-payments)
11. [Module Documents & Reports](#11-module-documents--reports)
12. [Module Messagerie](#12-module-messagerie)
13. [Module Notifications](#13-module-notifications)
14. [Module Dashboard](#14-module-dashboard)
15. [Module Administration](#15-module-administration)
16. [Règles métier](#16-règles-métier)
17. [Gestion des fichiers](#17-gestion-des-fichiers)
18. [Sécurité](#18-sécurité)
19. [Codes d'erreur standard](#19-codes-derreur-standard)

---

## 1. Présentation générale

**Immo Plus CM** est une plateforme SaaS de gestion immobilière destinée au marché camerounais. Elle permet à des propriétaires et gestionnaires de biens immobiliers de gérer leur portefeuille, leurs locataires, leurs contrats et leurs paiements depuis une interface unifiée.

### 1.1 Périmètre du backend

Le backend doit exposer une **API REST JSON** sécurisée couvrant :
- L'authentification et la gestion des sessions
- La gestion complète du cycle de vie des biens (ajout, modification, publication, archivage)
- La gestion des locataires et de leurs dossiers
- Le cycle de vie des contrats (création, renouvellement, archivage)
- Le suivi des paiements (enregistrement, relances, historique)
- La génération de documents PDF (contrats, quittances, rapports)
- La messagerie interne et les notifications
- Les tableaux de bord et statistiques

### 1.2 Conventions API

- **Base URL :** `https://api.immoplus.cm/v1`
- **Format :** JSON (Content-Type: `application/json`)
- **Authentification :** Bearer JWT dans le header `Authorization`
- **Pagination :** paramètres `page` (défaut : 1) et `limit` (défaut : 20, max : 100)
- **Tri :** paramètre `sort` (ex : `sort=-createdAt` pour décroissant)
- **Dates :** format ISO 8601 — `YYYY-MM-DD` pour les dates, `YYYY-MM-DDTHH:mm:ssZ` pour les timestamps
- **Montants :** entiers en FCFA (pas de décimales)
- **Identifiants :** UUID v4

---

## 2. Acteurs et permissions

### 2.1 Rôles

| Rôle (enum) | Description |
|-------------|-------------|
| `admin` | Accès total au système, gestion des utilisateurs et de la configuration |
| `owner` | Gère ses propres biens, contrats, locataires et paiements |
| `manager` | Gère les biens d'un ou plusieurs propriétaires selon délégation |
| `tenant` | Accès en lecture à son contrat, ses quittances, ses paiements |
| `visitor` | Accès public uniquement (recherche de biens) |

### 2.2 Matrice des permissions

| Ressource | admin | owner | manager | tenant | visitor |
|-----------|:-:|:-:|:-:|:-:|:-:|
| Properties (public read) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Properties (CRUD) | ✓ | own | delegated | — | — |
| Tenants | ✓ | own | delegated | own profile | — |
| Contracts | ✓ | own | delegated | own (read) | — |
| Payments | ✓ | own | delegated | own (read) | — |
| Reports | ✓ | own | delegated | — | — |
| Messages | ✓ | ✓ | ✓ | ✓ | — |
| Users | ✓ | — | — | — | — |
| Administration | ✓ | — | — | — | — |

---

## 3. Architecture technique recommandée

### 3.1 Stack retenue

| Couche | Technologie | Version |
|--------|-------------|---------|
| **Runtime** | Node.js | 20 LTS |
| **Framework** | NestJS | 10+ |
| **Langage** | TypeScript | 5+ |
| **ORM** | Prisma | 5+ |
| **Base de données** | PostgreSQL | 16 |
| **Cache** | Redis | 7 |
| **Validation** | class-validator + class-transformer | latest |
| **Auth** | @nestjs/passport + passport-jwt | latest |
| **Stockage fichiers** | Cloudflare R2 (S3-compatible) | — |
| **Queue** | BullMQ (@nestjs/bull) | latest |
| **PDF** | Puppeteer (HTML→PDF) | latest |
| **Email** | Nodemailer + AWS SES | latest |
| **SMS/Mobile Money** | API MTN Cameroon / Orange Money | — |
| **Tests** | Jest + Supertest | latest |
| **Linter** | ESLint + Prettier | latest |
| **Swagger** |  | latest |

### 3.2 Architecture NestJS

```
src/
  auth/                     # Module authentification (JWT, OTP, refresh tokens)
  users/                    # Module utilisateurs
  properties/               # Module biens immobiliers
  tenants/                  # Module locataires
  contracts/                # Module contrats
  payments/                 # Module paiements
  documents/                # Module documents & rapports
  messages/                 # Module messagerie
  notifications/            # Module notifications
  dashboard/                # Module tableau de bord
  admin/                    # Module administration
  prisma/                   # PrismaService (singleton)
  storage/                  # Abstraction S3/R2
  queue/                    # Processeurs BullMQ (PDF, emails, SMS)
  common/
    decorators/             # @CurrentUser(), @Roles(), @Public()
    guards/                 # JwtAuthGuard, RolesGuard
    interceptors/           # TransformInterceptor, LoggingInterceptor
    filters/                # HttpExceptionFilter global
    pipes/                  # ValidationPipe global (whitelist: true, forbidNonWhitelisted: true)
    dto/                    # DTOs partagés (PaginationDto, etc.)
```

### 3.3 Prisma — Configuration

```prisma
// prisma/schema.prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

Chaque modèle utilise `@id @default(uuid())` comme clé primaire et inclut `createdAt` / `updatedAt` avec `@default(now())` / `@updatedAt`.

### 3.4 Variables d'environnement (.env)

```env
# Database
DATABASE_URL=postgresql://user:password@host:5432/immoplus

# JWT
JWT_SECRET=<secret-rs256-private-key>
JWT_PUBLIC_KEY=<rs256-public-key>
JWT_ACCESS_EXPIRY=1h
JWT_REFRESH_EXPIRY=30d

# Redis
REDIS_URL=redis://localhost:6379

# Storage (Cloudflare R2)
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=immoplus
R2_PUBLIC_URL=https://files.immoplus.cm

# Email (AWS SES)
AWS_SES_REGION=eu-west-1
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
EMAIL_FROM=noreply@immoplus.cm

# App
PORT=3000
NODE_ENV=production
FRONTEND_URL=https://immoplus.cm
```

### 3.5 Structure de base de données

Utiliser des **UUID** comme clé primaire sur toutes les tables. Toutes les tables doivent avoir `createdAt` et `updatedAt` gérés automatiquement par Prisma.

---

## 4. Modèles de données

### 4.1 User

```prisma
model User {
  id            String   @id @default(uuid())
  lastName      String   @db.VarChar(100)
  firstName     String   @db.VarChar(100)
  email         String   @unique @db.VarChar(255)
  phone         String?  @unique @db.VarChar(20)
  passwordHash  String   @db.VarChar(255)
  role          Role     @default(owner)
  avatarUrl     String?
  emailVerified Boolean  @default(false)
  isActive      Boolean  @default(true)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  ownedProperties  Property[]     @relation("PropertyOwner")
  managedProperties Property[]    @relation("PropertyManager")
  tenantProfile    Tenant?
  sentMessages     Message[]      @relation("MessageSender")
  receivedMessages Message[]      @relation("MessageRecipient")
  notifications    Notification[]
  refreshTokens    RefreshToken[]

  @@map("users")
}

enum Role {
  admin
  owner
  manager
  tenant
  visitor
}
```

### 4.2 Property

```prisma
model Property {
  id           String         @id @default(uuid())
  slug         String         @unique @db.VarChar(255)
  title        String         @db.VarChar(255)
  type         PropertyType
  city         String         @db.VarChar(100)
  neighborhood String         @db.VarChar(100)
  address      String
  latitude     Decimal?       @db.Decimal(10, 8)
  longitude    Decimal?       @db.Decimal(11, 8)
  price        Int
  priceLabel   String         @db.VarChar(100)
  area         Decimal        @db.Decimal(8, 2)
  bedrooms     Int?           @db.SmallInt
  bathrooms    Int?           @db.SmallInt
  floor        Int?           @db.SmallInt
  description  String?
  status       PropertyStatus @default(Available)
  ownerId      String
  managerId    String?
  isPublished  Boolean        @default(false)
  deletedAt    DateTime?
  createdAt    DateTime       @default(now())
  updatedAt    DateTime       @updatedAt

  owner     User            @relation("PropertyOwner", fields: [ownerId], references: [id])
  manager   User?           @relation("PropertyManager", fields: [managerId], references: [id])
  images    PropertyImage[]
  documents PropertyDocument[]
  contracts Contract[]
  payments  Payment[]

  @@map("properties")
}

model PropertyImage {
  id         String   @id @default(uuid())
  propertyId String
  url        String
  isCover    Boolean  @default(false)
  order      Int      @db.SmallInt
  createdAt  DateTime @default(now())

  property Property @relation(fields: [propertyId], references: [id], onDelete: Cascade)

  @@map("property_images")
}

model PropertyDocument {
  id           String   @id @default(uuid())
  propertyId   String
  name         String   @db.VarChar(255)
  url          String
  documentType String?  @db.VarChar(100)
  createdAt    DateTime @default(now())

  property Property @relation(fields: [propertyId], references: [id], onDelete: Cascade)

  @@map("property_documents")
}

enum PropertyType {
  Apartment
  Villa
  Office
  House
  Land
  Commercial
  Building
}

enum PropertyStatus {
  Available
  Rented
  Maintenance
  Reserved
}

### 4.3 Tenant

```prisma
model Tenant {
  id              String   @id @default(uuid())
  userId          String?  @unique
  lastName        String   @db.VarChar(100)
  firstName       String   @db.VarChar(100)
  email           String   @db.VarChar(255)
  phone           String   @db.VarChar(20)
  nationalIdNumber String  @db.VarChar(50)
  occupation      String   @db.VarChar(150)
  income          Int
  ownerId         String
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  user      User?      @relation(fields: [userId], references: [id])
  contracts Contract[]
  payments  Payment[]

  @@map("tenants")
}

### 4.4 Contract

```prisma
model Contract {
  id               String         @id @default(uuid())
  propertyId       String
  tenantId         String
  startDate        DateTime       @db.Date
  endDate          DateTime       @db.Date
  rent             Int
  fees             Int            @default(0)
  deposit          Int
  status           ContractStatus @default(Active)
  parentContractId String?
  pdfUrl           String?
  createdAt        DateTime       @default(now())
  updatedAt        DateTime       @updatedAt

  property       Property         @relation(fields: [propertyId], references: [id])
  tenant         Tenant           @relation(fields: [tenantId], references: [id])
  parentContract Contract?        @relation("ContractRenewal", fields: [parentContractId], references: [id])
  renewals       Contract[]       @relation("ContractRenewal")
  clauses        ContractClause[]
  payments       Payment[]

  @@map("contracts")
}

model ContractClause {
  id         String @id @default(uuid())
  contractId String
  text       String
  order      Int    @db.SmallInt

  contract Contract @relation(fields: [contractId], references: [id], onDelete: Cascade)

  @@map("contract_clauses")
}

enum ContractStatus {
  Active
  Expired
  Terminated
  Renewal
}

### 4.5 Payment

```prisma
model Payment {
  id            String        @id @default(uuid())
  contractId    String
  tenantId      String
  propertyId    String
  amount        Int
  period        String        @db.VarChar(20)
  paymentDate   DateTime?     @db.Date
  dueDate       DateTime      @db.Date
  status        PaymentStatus
  paymentMethod PaymentMethod?
  reference     String?       @db.VarChar(100)
  receiptUrl    String?
  createdAt     DateTime      @default(now())
  updatedAt     DateTime      @updatedAt

  contract Contract @relation(fields: [contractId], references: [id])
  tenant   Tenant   @relation(fields: [tenantId], references: [id])
  property Property @relation(fields: [propertyId], references: [id])

  @@map("payments")
}

enum PaymentStatus {
  Paid
  Pending
  Late
  Cancelled
}

enum PaymentMethod {
  MobileMoney
  Transfer
  Cash
  Card
}

### 4.6 Message

```prisma
model Message {
  id           String   @id @default(uuid())
  senderId     String
  recipientId  String
  content      String
  isRead       Boolean  @default(false)
  attachmentUrl String?
  createdAt    DateTime @default(now())

  sender    User @relation("MessageSender",    fields: [senderId],    references: [id])
  recipient User @relation("MessageRecipient", fields: [recipientId], references: [id])

  @@map("messages")
}
```

### 4.7 Notification

```prisma
model Notification {
  id        String   @id @default(uuid())
  userId    String
  type      String   @db.VarChar(50)
  title     String   @db.VarChar(255)
  body      String
  isRead    Boolean  @default(false)
  link      String?
  createdAt DateTime @default(now())

  user User @relation(fields: [userId], references: [id])

  @@map("notifications")
}
```

### 4.8 RefreshToken

```prisma
model RefreshToken {
  id        String   @id @default(uuid())
  userId    String
  token     String   @unique
  expiresAt DateTime
  revokedAt DateTime?
  createdAt DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("refresh_tokens")
}
```

---

## 5. Module Authentification

> Couvre les cas d'utilisation CU01, CU02

### 5.1 Inscription

**`POST /auth/register`** — Public

**Corps de la requête :**
```json
{
  "firstName": "Jean",
  "lastName": "Dupont",
  "email": "jean.dupont@email.cm",
  "phone": "+237655000000",
  "role": "owner",
  "password": "MotDePasse123!",
  "passwordConfirm": "MotDePasse123!"
}
```

**Réponse 201 :**
```json
{
  "message": "Account created. Check your email to activate your account.",
  "userId": "uuid"
}
```

**Comportement :**
- Valider email unique et téléphone unique
- Hasher le mot de passe avec bcrypt (cost factor : 12)
- Générer un OTP à 6 chiffres valable 15 minutes
- Envoyer l'OTP par email ET par SMS
- Ne pas retourner de token avant vérification email

**Règles de validation :**
- `email` : format valide
- `phone` : doit commencer par `+237` et être valide
- `password` : min 8 caractères, au moins 1 majuscule, 1 chiffre
- `role` : uniquement `owner`, `manager`, `tenant` (le rôle `admin` ne peut être attribué que par un admin)

---

### 5.2 Vérification email par OTP

**`POST /auth/verify-email`** — Public

```json
{
  "userId": "uuid",
  "otp": "482951"
}
```

**Réponse 200 :**
```json
{
  "accessToken": "jwt...",
  "refreshToken": "jwt...",
  "expiresIn": 3600,
  "user": { ... }
}
```

---

### 5.3 Renvoyer l'OTP

**`POST /auth/resend-otp`** — Public

```json
{ "userId": "uuid" }
```

**Comportement :** Rate limit à 3 tentatives par 10 minutes par userId.

---

### 5.4 Connexion

**`POST /auth/login`** — Public

```json
{
  "email": "jean.dupont@email.cm",
  "password": "MotDePasse123!"
}
```

**Réponse 200 :**
```json
{
  "accessToken": "eyJ...",
  "refreshToken": "eyJ...",
  "expiresIn": 3600,
  "user": {
    "id": "uuid",
    "lastName": "Dupont",
    "firstName": "Jean",
    "email": "jean.dupont@email.cm",
    "phone": "+237655000000",
    "role": "owner",
    "avatarUrl": null
  }
}
```

**Comportement :**
- Rejeter si `emailVerified = false`
- Rejeter si `isActive = false`
- Access token : durée de vie 1 heure (JWT)
- Refresh token : durée de vie 30 jours (JWT, stocké en base pour révocation)
- Logger les tentatives de connexion échouées (rate limit : 5 tentatives / 15 min par IP)

---

### 5.5 Rafraîchir le token

**`POST /auth/refresh`** — Public (avec refresh token)

```json
{ "refreshToken": "eyJ..." }
```

**Réponse 200 :** Nouveau `accessToken` + nouveau `refreshToken` (rotation).

---

### 5.6 Déconnexion

**`POST /auth/logout`** — Authentifié

Invalide le refresh token en base.

---

### 5.7 Mot de passe oublié

**`POST /auth/forgot-password`** — Public

```json
{ "email": "jean.dupont@email.cm" }
```

Envoie un lien de réinitialisation valable 1 heure.

**`POST /auth/reset-password`** — Public

```json
{
  "token": "reset-token",
  "password": "NouveauMotDePasse123!",
  "password_confirm": "NouveauMotDePasse123!"
}
```

---

### 5.8 Changer le mot de passe

**`PATCH /auth/change-password`** — Authentifié

```json
{
  "currentPassword": "...",
  "newPassword": "...",
  "newPasswordConfirm": "..."
}
```

---

## 6. Module Utilisateurs

> Couvre CU03

### 6.1 Profil de l'utilisateur connecté

**`GET /users/me`** — Authentifié

Retourne le profil complet de l'utilisateur connecté.

**`PATCH /users/me`** — Authentifié

```json
{
  "firstName": "Jean",
  "lastName": "Dupont",
  "phone": "+237655000000",
  "avatarUrl": "https://..."
}
```

---

### 6.2 Upload de l'avatar

**`POST /users/me/avatar`** — Authentifié

Multipart/form-data avec le fichier image.  
Retourne l'`avatarUrl` après upload.

---

### 6.3 Liste des utilisateurs (admin)

**`GET /users`** — `admin` uniquement

**Query params :** `page`, `limit`, `role`, `search` (lastName or email), `isActive`

**Réponse 200 :**
```json
{
  "data": [ { ...user } ],
  "meta": { "total": 150, "page": 1, "limit": 20, "total_pages": 8 }
}
```

---

### 6.4 Gérer un utilisateur (admin)

**`GET /users/:id`** — Authentifié (admin ou profil propre)

**`PATCH /users/:id`** — `admin`

```json
{
  "role": "manager",
  "isActive": false
}
```

**`DELETE /users/:id`** — `admin` (soft delete : `isActive = false`)

---

### 6.5 Délégation à un gestionnaire

**`POST /users/:ownerId/delegations`** — `owner`

```json
{
  "managerId": "uuid",
  "propertyIds": ["uuid1", "uuid2"]
}
```

Accorde à un manager les droits de gestion sur les biens listés.

**`DELETE /users/:ownerId/delegations/:managerId`** — `owner`

Révoque la délégation.

---

## 7. Module Properties

> Couvre CU04, CU05, CU07, CU08, CU09, CU10

### 7.1 Liste publique des biens

**`GET /properties`** — Public

**Query params :**

| Paramètre | Type | Description |
|-----------|------|-------------|
| `city` | string | Filtrer par ville |
| `neighborhood` | string | Filtrer par quartier |
| `type` | string | `Apartment`, `Villa`, `Office`, `House`, `Land`, `Commercial`, `Building` |
| `status` | string | `Available`, `Rented`, `Maintenance`, `Reserved` |
| `minPrice` | integer | Prix minimum FCFA |
| `maxPrice` | integer | Prix maximum FCFA |
| `minArea` | integer | Surface min m² |
| `maxArea` | integer | Surface max m² |
| `bedrooms` | integer | Nombre de chambres |
| `search` | string | Recherche full-text (title, description, address) |
| `sort` | string | `-price`, `price`, `-createdAt`, `createdAt` |
| `page` | integer | |
| `limit` | integer | |

**Comportement :** Ne retourne que les biens avec `isPublished = true`.

**Réponse 200 :**
```json
{
  "data": [
    {
      "id": "uuid",
      "slug": "appartement-lumineux-bastos-a3f8c2d1",
      "title": "Appartement lumineux Bastos",
      "type": "Apartment",
      "city": "Yaoundé",
      "neighborhood": "Bastos",
      "address": "Rue des Ambassadeurs",
      "price": 250000,
      "priceLabel": "250 000 FCFA/mois",
      "area": 85,
      "bedrooms": 3,
      "bathrooms": 2,
      "status": "Available",
      "coverImageUrl": "https://...",
      "createdAt": "2025-01-15T10:30:00Z"
    }
  ],
  "meta": { "total": 48, "page": 1, "limit": 20, "totalPages": 3 }
}
```

---

### 7.2 Détail d'un bien (public)

**`GET /properties/:slug`** — Public

Retourne le bien complet avec toutes ses images, documents et informations.

```json
{
  "id": "uuid",
  "slug": "...",
  "title": "...",
  "type": "Apartment",
  "city": "Yaoundé",
  "neighborhood": "Bastos",
  "address": "...",
  "price": 250000,
  "priceLabel": "250 000 FCFA/mois",
  "area": 85,
  "bedrooms": 3,
  "bathrooms": 2,
  "floor": 2,
  "description": "...",
  "status": "Available",
  "images": [
    { "id": "uuid", "url": "https://...", "isCover": true, "order": 0 }
  ],
  "documents": [
    { "id": "uuid", "name": "Titre foncier", "url": "https://...", "documentType": "Titre foncier" }
  ],
  "latitude": 3.866667,
  "longitude": 11.516667,
  "createdAt": "2025-01-15T10:30:00Z"
}
```

---

### 7.3 Biens du dashboard (authentifié)

**`GET /dashboard/properties`** — `owner`, `manager`, `admin`

Retourne uniquement les biens appartenant à l'utilisateur connecté (ou délégués pour un manager). Inclut aussi les biens non publiés.

**Query params :** Mêmes filtres qu'en public + `isPublished`.

---

### 7.4 Créer un bien

**`POST /properties`** — `owner`, `manager`, `admin`

```json
{
  "title": "Appartement lumineux Bastos",
  "type": "Apartment",
  "city": "Yaoundé",
  "neighborhood": "Bastos",
  "address": "Rue des Ambassadeurs, n°12",
  "latitude": 3.866667,
  "longitude": 11.516667,
  "price": 250000,
  "area": 85,
  "bedrooms": 3,
  "bathrooms": 2,
  "floor": 2,
  "description": "Bel appartement lumineux...",
  "status": "Available"
}
```

**Réponse 201 :** Le bien créé avec son `id` et `slug`.

**Comportement :**
- Générer automatiquement le `slug` depuis le title (slugify + suffixe UUID court si collision)
- `ownerId` = ID de l'utilisateur connecté
- Le bien est créé avec `isPublished = false` par défaut
- Calculer `priceLabel` : `"250 000 FCFA/mois"`

---

### 7.5 Upload des photos d'un bien

**`POST /properties/:id/images`** — Propriétaire du bien

Multipart/form-data, champ `images[]` (jusqu'à 4 fichiers).

**Règles :**
- Maximum 4 images par bien
- Formats acceptés : JPEG, PNG, WebP
- Taille max : 10 Mo par image
- Redimensionner et optimiser côté serveur (largeur max : 1920px)
- Générer une miniature (400px) pour l'affichage liste

**Réponse 201 :**
```json
{
  "images": [
    { "id": "uuid", "url": "https://...", "isCover": true, "order": 0 }
  ]
}
```

---

### 7.6 Définir la photo de couverture

**`PATCH /properties/:id/images/:imageId/cover`** — Propriétaire du bien

Définit cette image comme couverture (met toutes les autres à `isCover = false`).

---

### 7.7 Supprimer une image

**`DELETE /properties/:id/images/:imageId`** — Propriétaire du bien

Supprime du stockage et de la base. Si c'était la couverture, promouvoir la suivante.

---

### 7.8 Upload des documents d'un bien

**`POST /properties/:id/documents`** — Propriétaire du bien

Multipart/form-data, champ `documents[]` (PDF uniquement).

```
Body (form-data):
  documents[]: file.pdf
  names[]: "Titre foncier"     ← optionnel, même index
```

---

### 7.9 Modifier un bien

**`PATCH /properties/:id`** — Propriétaire du bien

Corps partiel — seuls les champs fournis sont modifiés.

---

### 7.10 Publier / dépublier un bien

**`PATCH /properties/:id/publish`** — Propriétaire du bien

```json
{ "isPublished": true }
```

**Prérequis pour publication :** Le bien doit avoir au moins 1 image.

---

### 7.11 Changer le statut d'un bien

**`PATCH /properties/:id/status`** — Propriétaire du bien

```json
{ "status": "Maintenance" }
```

**Règle :** Le statut `Rented` est géré automatiquement lors de la création/résiliation d'un contrat actif.

---

### 7.12 Supprimer un bien

**`DELETE /properties/:id`** — Propriétaire du bien, `admin`

**Règle :** Impossible si un contrat `Active` existe sur ce bien. Retourner 409.

Soft delete : ajouter un champ `deletedAt`.

---

## 8. Module Tenants

> Couvre CU06 (dossier candidature)

### 8.1 Liste des locataires

**`GET /tenants`** — `owner`, `manager`, `admin`

Retourne les locataires liés aux biens de l'utilisateur connecté.

**Query params :** `search` (lastName, email), `page`, `limit`

**Réponse 200 :**
```json
{
  "data": [
    {
      "id": "uuid",
      "lastName": "Nkeng",
      "firstName": "Paul",
      "email": "paul.nkeng@email.cm",
      "phone": "+237655345678",
      "occupation": "Ingénieur informatique",
      "income": 800000,
      "activeContract": {
        "id": "uuid",
        "propertyTitle": "Appartement Bastos",
        "rent": 250000,
        "endDate": "2026-03-31"
      },
      "createdAt": "2024-03-15"
    }
  ],
  "meta": { ... }
}
```

---

### 8.2 Créer un locataire

**`POST /tenants`** — `owner`, `manager`

```json
{
  "firstName": "Paul",
  "lastName": "Nkeng",
  "email": "paul.nkeng@email.cm",
  "phone": "+237655345678",
  "nationalIdNumber": "123456789",
  "occupation": "Ingénieur informatique",
  "income": 800000
}
```

**Comportement :**
- Le `ownerId` = ID de l'utilisateur connecté
- Si un utilisateur existe avec cet email, lier via `userId`
- Sinon créer le profil locataire seul (sans compte)

---

### 8.3 Détail d'un locataire

**`GET /tenants/:id`** — Propriétaire du locataire

Inclut : profil complet + historique des contrats + historique des paiements.

---

### 8.4 Modifier un locataire

**`PATCH /tenants/:id`** — Propriétaire du locataire

Corps partiel.

---

### 8.5 Dossier de candidature (CU06)

**`POST /properties/:slug/applications`** — `tenant`, public connecté

```json
{
  "tenantId": "uuid",
  "message": "Je suis intéressé par ce bien...",
  "income": 800000,
  "occupation": "Ingénieur"
}
```

Le propriétaire reçoit une notification.

**`GET /properties/:id/applications`** — Propriétaire du bien

Liste des candidatures reçues.

**`PATCH /properties/:id/applications/:applicationId`** — Propriétaire

```json
{ "status": "accepted" }
```

Statuts : `pending`, `accepted`, `rejected`.

---

## 9. Module Contracts

> Couvre CU11, CU12, CU13, CU14

### 9.1 Liste des contrats

**`GET /contracts`** — Authentifié (owner : ses contrats, tenant : son contrat)

**Query params :** `status`, `propertyId`, `tenantId`, `page`, `limit`

**Réponse 200 :**
```json
{
  "data": [
    {
      "id": "uuid",
      "property": { "id": "uuid", "title": "...", "coverImageUrl": "..." },
      "tenant": { "id": "uuid", "lastName": "Nkeng", "firstName": "Paul", "email": "..." },
      "startDate": "2024-04-01",
      "endDate": "2025-03-31",
      "rent": 450000,
      "fees": 30000,
      "deposit": 900000,
      "status": "Active",
      "pdfUrl": "https://...",
      "createdAt": "2024-03-28"
    }
  ],
  "meta": { ... }
}
```

---

### 9.2 Créer un contrat

**`POST /contracts`** — `owner`, `manager`

```json
{
  "propertyId": "uuid",
  "tenantId": "uuid",
  "startDate": "2025-06-01",
  "endDate": "2026-05-31",
  "rent": 250000,
  "fees": 20000,
  "deposit": 500000,
  "clauses": [
    "Le locataire s'engage à maintenir le bien en bon état.",
    "Toute sous-location est strictement interdite."
  ]
}
```

**Comportement côté serveur :**
1. Vérifier que le bien appartient à l'utilisateur connecté
2. Vérifier que le bien a le statut `Available` ou `Reserved`
3. Vérifier qu'il n'y a pas de contrat `Active` en cours sur ce bien
4. Créer le contrat avec `status = Active`
5. Mettre à jour le bien : `status = Rented`
6. **Générer automatiquement le PDF du contrat** (tâche asynchrone)
7. **Générer les échéances de paiement** mensuelles entre `startDate` et `endDate` avec statut `Pending`
8. Envoyer une notification au locataire

---

### 9.3 Détail d'un contrat

**`GET /contracts/:id`** — Propriétaire du contrat ou locataire concerné

Inclut : property, tenant, clauses, liste des paiements associés.

---

### 9.4 Renouveler un contrat (CU12)

**`POST /contracts/:id/renewal`** — `owner`, `manager`

```json
{
  "endDate": "2027-05-31",
  "rent": 270000,
  "clauses": ["..."]
}
```

**Comportement :**
1. Vérifier que le contrat a le statut `Active` ou `Expired`
2. Calculer `startDate` = `oldEndDate + 1 jour`
3. Créer un **nouveau contrat** avec `parentContractId` = ancien contrat ID
4. Mettre l'ancien contrat en `status = Renewal` puis `Expired` à la nouvelle date de début
5. Générer le PDF de l'avenant
6. Générer les nouvelles échéances de paiement
7. Notifier le locataire

---

### 9.5 Résilier un contrat (CU13)

**`POST /contracts/:id/termination`** — `owner`, `manager`

```json
{
  "terminationDate": "2025-12-31",
  "reason": "Départ volontaire du locataire",
  "depositRefund": 850000
}
```

**Comportement :**
1. Passer le contrat en `status = Terminated`
2. Annuler les échéances de paiement `Pending` postérieures à `terminationDate`
3. Passer le bien en `status = Available`
4. Notifier le locataire
5. Enregistrer le montant du dépôt restitué

---

### 9.6 Télécharger le PDF du contrat

**`GET /contracts/:id/pdf`** — Propriétaire ou locataire concerné

Retourne un lien signé (durée 15 min) ou redirige vers le fichier.

---

### 9.7 Génération des quittances (CU14)

**`POST /contracts/:id/receipts`** — `owner`, `manager`

Génère et envoie les quittances pour les paiements du mois courant (ou d'une période donnée).

```json
{ "period": "June 2025" }
```

**`GET /payments/:id/receipt`** — Propriétaire ou locataire

Télécharge la quittance d'un paiement spécifique.

---

## 10. Module Payments

> Couvre CU15, CU16, CU17, CU18

### 10.1 Liste des paiements

**`GET /payments`** — Authentifié

**Query params :** `contractId`, `tenantId`, `propertyId`, `status`, `period`, `startDate`, `endDate`, `page`, `limit`, `sort`

**Réponse 200 :**
```json
{
  "data": [
    {
      "id": "uuid",
      "contractId": "uuid",
      "property": { "id": "uuid", "title": "..." },
      "tenant": { "id": "uuid", "lastName": "Nkeng", "firstName": "Paul" },
      "amount": 480000,
      "period": "June 2025",
      "paymentDate": "2025-06-03",
      "dueDate": "2025-06-05",
      "status": "Paid",
      "paymentMethod": "MobileMoney",
      "reference": "MTN-20250603-001",
      "receiptUrl": "https://..."
    }
  ],
  "meta": { ... }
}
```

---

### 10.2 Enregistrer un paiement (CU16)

**`POST /payments`** — `owner`, `manager`

```json
{
  "contractId": "uuid",
  "period": "June 2025",
  "amount": 480000,
  "dueDate": "2025-06-05",
  "status": "Paid",
  "paymentDate": "2025-06-03",
  "paymentMethod": "MobileMoney",
  "reference": "MTN-20250603-001"
}
```

**Comportement :**
1. Vérifier que le contrat appartient à l'utilisateur connecté
2. Résoudre automatiquement `tenantId` et `propertyId` depuis le contrat
3. Si `status = Paid`, générer la quittance PDF (tâche asynchrone)
4. Envoyer la quittance par email au locataire
5. Si une échéance existante correspond à la période, la mettre à jour plutôt qu'en créer une nouvelle

---

### 10.3 Modifier un paiement

**`PATCH /payments/:id`** — Propriétaire du paiement

Permettre la modification du status, paymentMethod, reference.

---

### 10.4 Tableau de bord des impayés (CU17)

**`GET /payments/overdue`** — Authentifié

Retourne la liste des paiements `Late` et `Pending` dépassant leur `dueDate`.

**Réponse :**
```json
{
  "totalAmount": 1250000,
  "count": 5,
  "data": [ { ...payment, "daysLate": 12 } ]
}
```

---

### 10.5 Envoyer des rappels (CU18)

**`POST /payments/reminders`** — `owner`, `manager`

```json
{
  "paymentIds": ["uuid1", "uuid2"],
  "channel": "email"
}
```

Canaux : `email`, `sms`, `both`.

**`PUT /notifications/payment-alerts`** — Authentifié

Configure les règles d'alerte automatique.

```json
{
  "active": true,
  "daysBeforeDue": 5,
  "daysAfterDue": [1, 3, 7],
  "channel": "both"
}
```

---

### 10.6 Statistiques de paiement

**`GET /payments/stats`** — Authentifié

**Query params :** `year`, `month`, `propertyId`

**Réponse :**
```json
{
  "totalCollected": 4800000,
  "totalPending": 480000,
  "totalLate": 165000,
  "collectionRate": 87.5,
  "byMonth": [
    { "month": "2025-01", "collected": 800000, "expected": 800000 }
  ]
}
```

---

## 11. Module Documents & Reports

> Couvre CU19, CU20, CU21

### 11.1 Rapport financier (CU19)

**`GET /reports/financial`** — `owner`, `manager`, `admin`

**Query params :** `startDate`, `endDate`, `propertyId`, `type` (`revenue`, `fees`, `profitability`)

**Réponse :**
```json
{
  "period": { "start": "2025-01-01", "end": "2025-12-31" },
  "grossRevenue": 9600000,
  "totalFees": 360000,
  "netRevenue": 9240000,
  "avgOccupancyRate": 92.3,
  "byProperty": [
    {
      "propertyId": "uuid",
      "title": "...",
      "revenue": 5400000,
      "fees": 180000,
      "occupancyRate": 100
    }
  ]
}
```

---

### 11.2 Taux d'occupation (CU20)

**`GET /reports/occupancy`** — Authentifié

**Query params :** `year`, `propertyId`

**Réponse :**
```json
{
  "globalRate": 88.5,
  "properties": [
    {
      "propertyId": "uuid",
      "title": "...",
      "rate": 100,
      "daysOccupied": 365,
      "daysVacant": 0
    }
  ]
}
```

---

### 11.3 Export PDF (CU21)

**`POST /reports/export`** — Authentifié

```json
{
  "type": "financial",
  "startDate": "2025-01-01",
  "endDate": "2025-12-31",
  "propertyId": "uuid"
}
```

**Réponse 202 :** Tâche asynchrone. Retourne un `jobId`.

**`GET /reports/export/:jobId`** — Authentifié

Polling du statut. Quand `status = completed`, retourne le `pdfUrl`.

---

### 11.4 Analyse de rentabilité (CU31)

**`GET /reports/profitability/:propertyId`** — `owner`, `manager`

**Query params :** `startDate`, `endDate`

**Réponse :**
```json
{
  "property": { ... },
  "initialInvestment": 0,
  "cumulativeRevenue": 5400000,
  "cumulativeFees": 180000,
  "avgMonthlyCashFlow": 432000,
  "vacancyRate": 8.3,
  "roi": null
}
```

---

## 12. Module Messagerie

> Couvre CU22

### 12.1 Liste des conversations

**`GET /messages/conversations`** — Authentifié

```json
{
  "data": [
    {
      "contact": { "id": "uuid", "lastName": "...", "firstName": "...", "avatarUrl": "..." },
      "lastMessage": { "content": "...", "createdAt": "..." },
      "unreadCount": 2
    }
  ]
}
```

---

### 12.2 Messages d'une conversation

**`GET /messages/:userId`** — Authentifié

Retourne les messages échangés avec un utilisateur donné, triés par date.

**Query params :** `page`, `limit`

---

### 12.3 Envoyer un message

**`POST /messages`** — Authentifié

```json
{
  "recipientId": "uuid",
  "content": "Bonjour, je souhaite visiter l'appartement."
}
```

**Comportement :**
- Créer le message
- Envoyer une notification push/email au destinataire
- Retourner le message créé

---

### 12.4 Marquer comme lu

**`PATCH /messages/:conversationUserId/read`** — Authentifié

Marque tous les messages de cette conversation comme lus.

---

### 12.5 Upload de pièce jointe

**`POST /messages/attachments`** — Authentifié

Multipart/form-data. Retourne l'URL. À inclure ensuite dans `POST /messages`.

---

## 13. Module Notifications

> Couvre CU23

### 13.1 Liste des notifications

**`GET /notifications`** — Authentifié

**Query params :** `isRead` (true/false), `type`, `page`, `limit`

---

### 13.2 Marquer comme lue

**`PATCH /notifications/:id/read`** — Authentifié

**`PATCH /notifications/read-all`** — Authentifié

Marque toutes les notifications de l'utilisateur comme lues.

---

### 13.3 Compteur de notifications non lues

**`GET /notifications/count`** — Authentifié

```json
{ "count": 5 }
```

---

### 13.4 Types de notifications système

Le système génère automatiquement des notifications pour les événements suivants :

| Type | Déclencheur | Destinataire |
|------|-------------|-------------|
| `payment_received` | Paiement enregistré | Owner |
| `payment_late` | Date limite dépassée | Owner + Tenant |
| `lease_expiring_soon` | J-30, J-15, J-7 avant la fin du contrat | Owner |
| `contract_expired` | Contrat arrivé à terme | Owner + Tenant |
| `new_message` | Message reçu | Recipient |
| `application_received` | Nouvelle candidature sur un bien | Owner |
| `application_accepted` | Candidature acceptée | Tenant |
| `property_published` | Bien publié | Owner |
| `maintenance_reported` | Problème technique signalé | Owner |

---

### 13.5 Préférences de notification

**`GET /notifications/preferences`** — Authentifié

**`PUT /notifications/preferences`** — Authentifié

```json
{
  "email": {
    "payment_late": true,
    "lease_expiring_soon": true,
    "new_message": false
  },
  "sms": {
    "payment_late": true,
    "lease_expiring_soon": false
  }
}
```

---

## 14. Module Dashboard

> Couvre CU25, CU26, CU27

### 14.1 Tableau de bord propriétaire / gestionnaire

**`GET /dashboard/stats`** — `owner`, `manager`

**Réponse :**
```json
{
  "properties": {
    "total": 12,
    "available": 3,
    "rented": 8,
    "maintenance": 1,
    "reserved": 0
  },
  "monthlyPayments": {
    "collected": 3840000,
    "expected": 4320000,
    "late": 480000
  },
  "contracts": {
    "active": 8,
    "expiringIn30Days": 2
  },
  "tenants": {
    "total": 10
  },
  "unreadMessages": 3,
  "unreadNotifications": 7,
  "last12MonthsRevenue": [
    { "month": "2024-06", "amount": 3500000 }
  ]
}
```

---

### 14.2 Espace locataire (CU26)

**`GET /dashboard/tenant`** — `tenant`

```json
{
  "contract": {
    "id": "uuid",
    "property": { "title": "...", "address": "...", "coverImageUrl": "..." },
    "rent": 250000,
    "fees": 20000,
    "startDate": "2025-06-01",
    "endDate": "2026-05-31",
    "status": "Active"
  },
  "recentPayments": [ { ...payment } ],
  "nextPayment": {
    "amount": 270000,
    "dueDate": "2025-07-05",
    "period": "July 2025"
  },
  "unreadMessages": 1
}
```

---

### 14.3 Signalement de problème (CU24)

**`POST /maintenance-requests`** — `tenant`

```json
{
  "propertyId": "uuid",
  "title": "Fuite d'eau dans la salle de bain",
  "description": "Le robinet du lavabo fuit en permanence.",
  "urgency": "high",
  "images": ["url1", "url2"]
}
```

Niveaux d'urgence : `low`, `normal`, `high`, `critical`.

**`GET /maintenance-requests`** — Propriétaire / locataire

**`PATCH /maintenance-requests/:id`** — Propriétaire

```json
{
  "status": "in_progress",
  "comment": "Un plombier interviendra le 15/06."
}
```

Statuts : `open`, `in_progress`, `resolved`, `closed`.

---

## 15. Module Administration

> Couvre CU28, CU29, CU30

### 15.1 Statistiques globales (admin)

**`GET /admin/stats`** — `admin`

```json
{
  "users": { "total": 350, "owners": 85, "tenants": 240, "managers": 25 },
  "properties": { "total": 420, "published": 380 },
  "contracts": { "active": 295 },
  "monthlyPaymentVolume": 125000000
}
```

---

### 15.2 Gestion des paramètres système (CU29)

**`GET /admin/settings`** — `admin`

**`PUT /admin/settings`** — `admin`

```json
{
  "platformName": "Immo Plus CM",
  "supportEmail": "support@immoplus.cm",
  "daysBeforeDueReminder": 5,
  "daysAfterLateReminder": [1, 3, 7],
  "vatRate": 19.25,
  "defaultClauses": [
    "Le locataire s'engage à maintenir le bien en bon état.",
    "Toute sous-location est strictement interdite sans accord écrit."
  ]
}
```

---

### 15.3 Travaux et maintenances (CU32)

**`GET /maintenance-requests`** — Propriétaire / manager / admin

**`PATCH /maintenance-requests/:id`** — Propriétaire / manager

---

## 16. Règles métier

### 16.1 Statut des biens

```
Available ──[Contract created]──► Rented
Rented    ──[Contract terminated/expired]──► Available
Available ──[Maintenance reported]──► Maintenance
Maintenance ──[Maintenance resolved]──► Available
Available ──[Manually reserved]──► Reserved
Reserved  ──[Contract created / released]──► Rented / Available
```

**Règle :** Le statut `Rented` ne peut être défini manuellement que par un admin. Il est géré automatiquement par le cycle des contrats.

---

### 16.2 Génération automatique des échéances

À la création d'un contrat, le système génère automatiquement les paiements mensuels :

- Une échéance par mois entre `startDate` et `endDate`
- Montant = `rent + fees`
- `dueDate` = 5ème jour du mois concerné
- `status = Pending`
- `period` = format "Month Year" (ex : "June 2025")

---

### 16.3 Passage en statut "Late"

Un job planifié (cron) tourne **chaque jour à 00h01** et passe en `Late` tous les paiements :
- `status = Pending`
- `dueDate < today`

---

### 16.4 Expiration automatique des contrats

Un cron **quotidien** vérifie les contrats dont `endDate < today` et `status = Active` :
1. Passe le contrat en `status = Expired`
2. Passe le bien en `status = Available`
3. Envoie les notifications d'expiration
4. Annule les échéances `Pending` restantes

---

### 16.5 Alertes d'échéance de bail

Un cron envoie une notification au propriétaire **J-30, J-15, J-7** avant `endDate` de chaque contrat actif.

---

### 16.6 Génération du slug

```
slug = slugify(title) + "-" + uuid.substring(0, 8)
// ex : "appartement-lumineux-bastos-a3f8c2d1"
```

Garantit l'unicité sans consultation de la base.

---

### 16.7 Calcul de priceLabel

```
priceLabel = price.toLocaleString("fr-FR") + " FCFA/mois"
// ex : "250 000 FCFA/mois"
```

Calculé côté serveur à chaque modification du price.

---

### 16.8 Contraintes de suppression

| Ressource | Condition de blocage |
|-----------|---------------------|
| `Property` | Contrat actif existant |
| `Tenant` | Contrat actif ou paiements en cours |
| `Contract` | Ne peut être supprimé, seulement résilié |
| `User` | Soft delete uniquement (`isActive = false`) |

---

## 17. Gestion des fichiers

### 17.1 Stockage

Utiliser un service S3-compatible. Organiser les fichiers selon la structure :

```
bucket/
  properties/
    {propertyId}/
      images/
        {imageId}-original.jpg
        {imageId}-thumb.jpg
      documents/
        {docId}-{name}.pdf
  contracts/
    {contractId}/
      contract-{id}.pdf
      receipts/
        receipt-{period}.pdf
  avatars/
    {userId}.jpg
  reports/
    {userId}/
      report-{date}.pdf
```

### 17.2 Traitement des images

À l'upload d'une image de bien :
1. Valider le type MIME (JPEG, PNG, WebP uniquement)
2. Valider la taille (max 10 Mo)
3. Redimensionner : version `original` (max 1920×1080), version `thumb` (400×300), version `small` (800×600)
4. Compresser avec qualité 85%
5. Stocker les 3 versions
6. Retourner l'URL de la version `original` (la `thumb` est accessible en ajoutant `-thumb` au nom)

### 17.3 URLs signées

Pour les documents confidentiels (contrats, quittances), générer des URLs signées avec une expiration de **15 minutes**. Ne jamais exposer les URLs permanentes de ces fichiers en réponse API.

### 17.4 Génération PDF

Utiliser une bibliothèque de rendu HTML→PDF (Puppeteer, WeasyPrint, etc.) avec des templates prédéfinis pour :
- **Contrat de bail** : inclure toutes les clauses, les parties, les montants, le cachet
- **Quittance de loyer** : période, montant détaillé (loyer + charges), date de paiement, mode
- **Rapport financier** : graphiques, tableaux récapitulatifs

Les PDF sont générés en **tâche asynchrone** (queue) pour ne pas bloquer la réponse API.

---

## 18. Sécurité

### 18.1 Authentification JWT

```
Header: Authorization: Bearer <accessToken>

Payload JWT:
{
  "sub": "user_uuid",
  "role": "owner",
  "email": "...",
  "iat": 1234567890,
  "exp": 1234571490
}
```

- Access token : **1 heure**
- Refresh token : **30 jours**, stocké en base (table `refresh_tokens`) avec révocation possible
- Algorithme : **RS256** (clés asymétriques)

### 18.2 Autorisation (Guard par ressource)

Chaque endpoint doit vérifier :
1. Le token est valide et non expiré
2. L'utilisateur est actif (`is_active = true`)
3. L'utilisateur a le **rôle requis**
4. L'utilisateur est **propriétaire de la ressource** (ou admin/gestionnaire délégué)

### 18.3 Rate limiting

| Endpoint | Limite |
|----------|--------|
| `POST /auth/login` | 5 req / 15 min / IP |
| `POST /auth/register` | 3 req / heure / IP |
| `POST /auth/resend-otp` | 3 req / 10 min / user |
| `POST /messages` | 60 req / min / user |
| Tous les autres | 200 req / min / user |

### 18.4 Validation des données

- Utiliser une bibliothèque de validation stricte (Joi, Zod, class-validator)
- Rejeter toute propriété non déclarée dans le schéma (strict mode)
- Sanitizer les champs texte (protection XSS)
- Valider les UUID (rejeter les IDs malformés)

### 18.5 CORS

Configurer CORS pour n'autoriser que les origines de la plateforme frontend :
- `https://immoplus.cm`
- `https://www.immoplus.cm`
- `http://localhost:5173` (développement)

### 18.6 HTTPS

Toutes les communications doivent se faire exclusivement en HTTPS. Rediriger HTTP → HTTPS.

---

## 19. Codes d'erreur standard

Toutes les réponses d'erreur suivent ce format :

```json
{
  "statusCode": 422,
  "error": "VALIDATION_ERROR",
  "message": "Les données fournies sont invalides.",
  "details": [
    { "field": "email", "message": "Format d'email invalide." },
    { "field": "price", "message": "Le prix doit être un entier positif." }
  ]
}
```

### Codes HTTP utilisés

| Code | Signification | Usage |
|------|---------------|-------|
| `200` | OK | Succès (GET, PATCH) |
| `201` | Created | Ressource créée (POST) |
| `202` | Accepted | Tâche asynchrone lancée |
| `204` | No Content | Suppression réussie (DELETE) |
| `400` | Bad Request | Requête malformée |
| `401` | Unauthorized | Token manquant ou invalide |
| `403` | Forbidden | Authentifié mais non autorisé |
| `404` | Not Found | Ressource introuvable |
| `409` | Conflict | Conflit de données (ex : contrat actif existant) |
| `422` | Unprocessable Entity | Erreur de validation des données |
| `429` | Too Many Requests | Rate limit dépassé |
| `500` | Internal Server Error | Erreur serveur non gérée |

### Codes d'erreur métier

| Code erreur | Description |
|-------------|-------------|
| `PROPERTY_HAS_ACTIVE_CONTRACT` | Impossible de supprimer un bien avec un contrat actif |
| `PROPERTY_NOT_AVAILABLE` | Le bien n'est pas disponible pour un nouveau contrat |
| `EMAIL_ALREADY_EXISTS` | Email déjà utilisé |
| `EMAIL_NOT_VERIFIED` | Email non vérifié |
| `OTP_INVALID` | Code OTP incorrect |
| `OTP_EXPIRED` | Code OTP expiré |
| `REFRESH_TOKEN_INVALID` | Refresh token invalide ou révoqué |
| `INSUFFICIENT_PERMISSIONS` | Droits insuffisants sur cette ressource |
| `MAX_IMAGES_REACHED` | Maximum 4 images par bien |
| `CONTRACT_NOT_RENEWABLE` | Le contrat n'est pas dans un état renouvelable |
| `TENANT_HAS_ACTIVE_CONTRACT` | Locataire déjà lié à un contrat actif |
| `PERIOD_ALREADY_PAID` | Un paiement existe déjà pour cette période |

---

*Fin du document — Immo Plus CM Backend Specification v1.0*
