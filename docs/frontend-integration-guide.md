# Immo Plus CM — Guide d'intégration Frontend

> **Version** : 1.0 · **Date** : 2026-06-16 · **Base URL** : `https://api.immoplus.cm` (prod) · `http://localhost:3000` (dev)

Ce document est la référence unique pour les développeurs frontend (Flutter/Dio, React/Axios, React Native). Il décrit chaque endpoint tel qu'il est **réellement implémenté** dans le backend NestJS.

---

## Table des matières

1. [Architecture générale](#1-architecture-générale)
2. [Auth](#2-auth)
3. [Users](#3-users)
4. [Agencies](#4-agencies)
5. [Properties](#5-properties)
6. [Tenants](#6-tenants)
7. [Leases (Contrats)](#7-leases-contrats)
8. [Payments (Paiements)](#8-payments-paiements)
9. [Maintenance](#9-maintenance)
10. [Commissions](#10-commissions)
11. [Mandates](#11-mandates)
12. [Messages](#12-messages)
13. [Notifications](#13-notifications)
14. [Dashboard](#14-dashboard)
15. [Reports (Rapports)](#15-reports-rapports)
16. [Admin](#16-admin)
17. [Guides pratiques](#17-guides-pratiques)

---

## 1. Architecture générale

### 1.1 Format de réponse universelle

**Toutes** les réponses réussies sont enveloppées par le `TransformInterceptor` :

```json
{
  "data": { ... },
  "statusCode": 200,
  "timestamp": "2026-06-16T07:00:00.000Z"
}
```

**Toutes** les erreurs sont formatées par le `GlobalExceptionFilter` :

```json
{
  "statusCode": 400,
  "error": "VALIDATION_ERROR",
  "message": "Les données fournies sont invalides.",
  "details": ["email must be an email", "password is too short"],
  "path": "/auth/register",
  "timestamp": "2026-06-16T07:00:00.000Z"
}
```

| Champ | Type | Description |
|-------|------|-------------|
| `statusCode` | `number` | Code HTTP |
| `error` | `string` | Code d'erreur machine (ex: `EMAIL_ALREADY_EXISTS`) |
| `message` | `string` | Message lisible par l'humain |
| `details` | `string[]` | Présent uniquement pour erreurs de validation (class-validator) |
| `path` | `string` | URL appelée |
| `timestamp` | `string` | ISO 8601 |

### 1.2 Authentification JWT

#### Flux complet

```
1. POST /auth/register  → { userId }
2. POST /auth/verify-email { userId, otp } → { accessToken, refreshToken, user }
3. Stocker les tokens en local storage / secure storage
4. Ajouter Authorization: Bearer <accessToken> à chaque requête
5. Si 401 → POST /auth/refresh { refreshToken } → nouveau { accessToken, refreshToken }
6. POST /auth/logout { refreshToken } → révocation
```

#### Payload JWT décodé

```json
{
  "sub": "uuid-de-l-utilisateur",
  "email": "user@example.com",
  "role": "OWNER",
  "iat": 1718524800,
  "exp": 1718528400
}
```

#### Durées

| Token | Durée | Stockage recommandé |
|-------|-------|---------------------|
| `accessToken` | 1 heure | Memory / SecureStorage |
| `refreshToken` | 30 jours | SecureStorage (Keychain iOS / Keystore Android) |

#### Header requis

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

Les endpoints `@Public` n'ont pas besoin de ce header.

### 1.3 Pagination et recherche

Tous les endpoints de liste utilisent `POST /module/search` avec le corps suivant :

```json
{
  "pageNumber": 0,
  "pageSize": 20,
  "searchKey": "villa",
  "filters": {
    "status": ["ACTIVE"],
    "city": ["Yaoundé"],
    "createdAt": ["2026-01-01", "2026-12-31"]
  },
  "sortClauses": [
    { "fieldName": "createdAt", "direction": "DESC" }
  ]
}
```

| Champ | Type | Défaut | Description |
|-------|------|--------|-------------|
| `pageNumber` | `integer` | `0` | 0-indexé |
| `pageSize` | `integer` | `20` | Max 100 |
| `searchKey` | `string` | — | Recherche textuelle sur les champs searchable |
| `filters` | `object` | — | Clés = champs filtrables, valeurs = `string[]` |
| `sortClauses` | `array` | — | `[{ fieldName, direction: "ASC"\|"DESC" }]` |

**Réponse paginée (enveloppée dans `data`) :**

```json
{
  "data": {
    "data": [ ... ],
    "meta": {
      "total": 150,
      "pageNumber": 0,
      "pageSize": 20,
      "totalPages": 8
    }
  },
  "statusCode": 200,
  "timestamp": "..."
}
```

> ⚠️ Le champ de pagination est dans `data.data` (array) et `data.meta` (métadonnées).

### 1.4 Upload de fichiers

Les uploads utilisent `multipart/form-data`. Le champ `files` ou `photos[]` dépend de l'endpoint.

```
Content-Type: multipart/form-data
Authorization: Bearer <token>
```

> ⚠️ **État actuel** : Les images de propriétés retournent des URLs placeholder (`https://placeholder/...`). Les uploads réels (R2/S3) sont en cours d'implémentation.

### 1.5 Rôles disponibles

| Rôle | Description |
|------|-------------|
| `ADMIN` | Accès total |
| `OWNER` | Propriétaire immobilier |
| `MANAGER` | Gestionnaire d'agence (doit avoir un mandat actif) |
| `TENANT` | Locataire |
| `VISITOR` | Réservé, non utilisé |

### 1.6 Throttling

- **Global** : 200 requêtes / 60 secondes par IP
- **Candidatures** : 5 requêtes / heure (`POST /applications`)

### 1.7 Codes d'erreur fréquents

| Code HTTP | `error` | Cause fréquente |
|-----------|---------|-----------------|
| `400` | `VALIDATION_ERROR` | Champ manquant ou invalide |
| `400` | `OTP_INVALID` | Code OTP expiré ou déjà utilisé |
| `401` | `UnauthorizedException` | Token absent, expiré ou invalide |
| `401` | `EMAIL_NOT_VERIFIED` | Connexion avant vérification email |
| `401` | `REFRESH_TOKEN_INVALID` | Refresh token révoqué ou expiré |
| `403` | `ForbiddenException` | Rôle insuffisant ou accès non autorisé |
| `403` | `NO_ACTIVE_MANDATE` | MANAGER sans mandat actif sur la propriété |
| `404` | `NotFoundException` | Ressource introuvable |
| `409` | `EMAIL_ALREADY_EXISTS` | Email déjà enregistré |
| `422` | `UnprocessableEntityException` | CAPTCHA invalide |
| `429` | `ThrottlerException` | Trop de requêtes |
| `500` | `INTERNAL_SERVER_ERROR` | Erreur serveur |

---

## 2. Auth

**Base path** : `/auth`  
**Authentification** : Tous publics sauf `logout` et `change-password`

### Objectif métier
Gestion du cycle de vie complet des sessions utilisateur : inscription, vérification OTP, connexion, rafraîchissement de token, déconnexion, récupération de mot de passe.

### 2.1 `POST /auth/register`

**Public** · Crée un nouveau compte (OWNER ou TENANT uniquement).

#### Corps de la requête

```json
{
  "firstName": "Marc",
  "lastName": "Dupont",
  "email": "marc@example.com",
  "phone": "+237600000001",
  "role": "OWNER",
  "password": "Secret123",
  "passwordConfirm": "Secret123"
}
```

| Champ | Type | Requis | Contraintes |
|-------|------|--------|-------------|
| `firstName` | `string` | ✅ | |
| `lastName` | `string` | ✅ | |
| `email` | `string` | ✅ | Format email valide |
| `phone` | `string` | ❌ | Format `+237XXXXXXXXX` |
| `role` | `string` | ✅ | `"OWNER"` ou `"TENANT"` uniquement |
| `password` | `string` | ✅ | Min 8 chars, ≥1 majuscule, ≥1 chiffre |
| `passwordConfirm` | `string` | ✅ | Doit être identique à `password` |

#### Réponse `201`

```json
{
  "data": {
    "message": "Compte créé. Vérifiez votre email pour activer votre compte.",
    "userId": "a1b2c3d4-..."
  },
  "statusCode": 201,
  "timestamp": "2026-06-16T07:00:00.000Z"
}
```

#### Erreurs

| Code | `error` | Cause |
|------|---------|-------|
| `400` | `VALIDATION_ERROR` | Champ manquant / format invalide |
| `400` | `BadRequestException` | Mots de passe différents |
| `400` | `BadRequestException` | Rôle non autorisé (ADMIN/MANAGER) |
| `409` | `EMAIL_ALREADY_EXISTS` | Email déjà utilisé |
| `409` | `ConflictException` | Téléphone déjà utilisé |

---

### 2.2 `POST /auth/verify-email`

**Public** · Vérifie l'OTP reçu par email et retourne les tokens de session.

#### Corps

```json
{
  "userId": "a1b2c3d4-...",
  "otp": "482931"
}
```

#### Réponse `200`

```json
{
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "550e8400-e29b-41d4-a716-446655440000",
    "expiresIn": 3600,
    "user": {
      "id": "a1b2c3d4-...",
      "firstName": "Marc",
      "lastName": "Dupont",
      "email": "marc@example.com",
      "phone": "+237600000001",
      "role": "OWNER",
      "avatarUrl": null
    }
  },
  "statusCode": 200,
  "timestamp": "..."
}
```

#### Erreurs

| Code | `error` | Cause |
|------|---------|-------|
| `400` | `OTP_INVALID` | Code expiré (TTL 15 min) ou déjà utilisé |
| `404` | `NotFoundException` | `userId` inconnu |

---

### 2.3 `POST /auth/resend-otp`

**Public** · Renvoie un nouveau code OTP. Limité à 3 tentatives / 10 minutes.

#### Corps

```json
{ "userId": "a1b2c3d4-..." }
```

#### Réponse `200`

```json
{ "data": { "message": "OTP renvoyé avec succès." }, "statusCode": 200, "timestamp": "..." }
```

#### Erreurs

| Code | Cause |
|------|-------|
| `400` | Plus de 3 tentatives en 10 min |
| `404` | `userId` inconnu |

---

### 2.4 `POST /auth/login`

**Public** · Connexion par email + mot de passe.

#### Corps

```json
{
  "email": "marc@example.com",
  "password": "Secret123"
}
```

#### Réponse `200` — même format que `verify-email`

#### Erreurs

| Code | `error` | Cause |
|------|---------|-------|
| `401` | `UnauthorizedException` | Email ou mot de passe incorrect |
| `401` | `EMAIL_NOT_VERIFIED` | Email non vérifié → rediriger vers vérification OTP |
| `401` | `UnauthorizedException` | Compte désactivé |

---

### 2.5 `POST /auth/refresh`

**Public** · Échange un refresh token contre de nouveaux tokens.

> ⚠️ Le refresh token est **révoqué** à chaque utilisation (rotation). Stocker immédiatement le nouveau.

#### Corps

```json
{ "refreshToken": "550e8400-e29b-41d4-a716-446655440000" }
```

#### Réponse `200` — même format que `login`

#### Erreurs

| Code | `error` | Cause |
|------|---------|-------|
| `401` | `REFRESH_TOKEN_INVALID` | Token révoqué, expiré ou inconnu |

---

### 2.6 `POST /auth/logout`

**🔐 JWT requis** · Révoque le refresh token courant.

#### Corps

```json
{ "refreshToken": "550e8400-..." }
```

#### Réponse `200`

```json
{ "data": { "message": "Déconnecté avec succès." }, "statusCode": 200, "timestamp": "..." }
```

---

### 2.7 `POST /auth/forgot-password`

**Public** · Envoie un lien de réinitialisation par email (TTL 1h). Répond toujours avec succès pour éviter l'énumération d'emails.

#### Corps

```json
{ "email": "marc@example.com" }
```

#### Réponse `200`

```json
{ "data": { "message": "Si un compte avec cet email existe, un lien de réinitialisation a été envoyé." }, "statusCode": 200, "timestamp": "..." }
```

---

### 2.8 `POST /auth/reset-password`

**Public** · Réinitialise le mot de passe via le token reçu par email.

#### Corps

```json
{
  "token": "uuid-du-lien",
  "password": "NewSecret456",
  "password_confirm": "NewSecret456"
}
```

#### Réponse `200`

```json
{ "data": { "message": "Mot de passe réinitialisé avec succès." }, "statusCode": 200, "timestamp": "..." }
```

#### Erreurs

| Code | Cause |
|------|-------|
| `400` | Token expiré (>1h) ou déjà utilisé |
| `400` | Mots de passe différents |

---

### 2.9 `PATCH /auth/change-password`

**🔐 JWT requis** · Change le mot de passe en fournissant l'ancien.

#### Corps

```json
{
  "currentPassword": "Secret123",
  "newPassword": "NewSecret456",
  "newPasswordConfirm": "NewSecret456"
}
```

#### Réponse `200`

```json
{ "data": { "message": "Mot de passe modifié avec succès." }, "statusCode": 200, "timestamp": "..." }
```

#### Erreurs

| Code | Cause |
|------|-------|
| `401` | Mot de passe actuel incorrect |
| `400` | Nouveaux mots de passe différents |

---

### Exemples Auth

<details>
<summary>cURL — Login</summary>

```bash
curl -X POST https://api.immoplus.cm/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"marc@example.com","password":"Secret123"}'
```
</details>

<details>
<summary>Axios — Login</summary>

```javascript
const { data } = await axios.post('/auth/login', {
  email: 'marc@example.com',
  password: 'Secret123',
});
const { accessToken, refreshToken, user } = data.data;
localStorage.setItem('accessToken', accessToken);
localStorage.setItem('refreshToken', refreshToken);
```
</details>

<details>
<summary>Flutter/Dio — Login</summary>

```dart
final response = await dio.post('/auth/login', data: {
  'email': 'marc@example.com',
  'password': 'Secret123',
});
final payload = response.data['data'];
final accessToken = payload['accessToken'];
final refreshToken = payload['refreshToken'];
```
</details>

---

## 3. Users

**Base path** : `/users`  
**Authentification** : JWT requis (sauf mention)

### Objectif métier
Gestion des profils utilisateurs, mise à jour d'avatar, et administration des comptes (ADMIN).

### 3.1 `GET /users/profile`

**🔐 JWT requis** · Retourne le profil de l'utilisateur connecté.

#### Réponse `200`

```json
{
  "data": {
    "id": "uuid",
    "firstName": "Marc",
    "lastName": "Dupont",
    "email": "marc@example.com",
    "phone": "+237600000001",
    "role": "OWNER",
    "avatarUrl": "https://cdn.r2.dev/avatars/uuid.jpg",
    "isActive": true,
    "emailVerified": true,
    "createdAt": "2026-01-01T00:00:00.000Z"
  },
  "statusCode": 200,
  "timestamp": "..."
}
```

---

### 3.2 `PATCH /users/profile`

**🔐 JWT requis** · Met à jour le profil.

#### Corps (tous les champs sont optionnels)

```json
{
  "firstName": "Marc",
  "lastName": "Dupont",
  "phone": "+237600000002"
}
```

---

### 3.3 `POST /users/profile/avatar`

**🔐 JWT requis** · Upload d'avatar.

```
Content-Type: multipart/form-data
```

| Champ | Type | Description |
|-------|------|-------------|
| `file` | `File` | Image JPG/PNG |

#### Réponse `201`

```json
{ "data": { "avatarUrl": "https://cdn.r2.dev/avatars/uuid.jpg" }, "statusCode": 201, "timestamp": "..." }
```

---

### 3.4 `POST /users/search`

**🔐 ADMIN uniquement** · Liste paginée des utilisateurs.

Corps : [SearchRequestDto standard](#13-pagination-et-recherche)

**Filtres disponibles** : `role`, `isActive`, recherche par `firstName`, `lastName`, `email`

---

### 3.5 `GET /users/:id/detail`

**🔐 JWT requis** · Détail d'un utilisateur (ADMIN voit tous, les autres voient seulement leur propre profil).

---

### 3.6 `PATCH /users/:id/update`

**🔐 ADMIN uniquement** · Mise à jour administrative.

#### Corps

```json
{
  "role": "MANAGER",
  "isActive": true
}
```

> ⚠️ `role` ne peut pas être `ADMIN` via cet endpoint.

---

### 3.7 `DELETE /users/:id`

**🔐 ADMIN uniquement** · Désactivation soft (soft delete).

---

### 3.8 `POST /users/:ownerId/delegations`

**🔐 OWNER uniquement** · Délègue la gestion de propriétés à un MANAGER sans agence.

#### Corps

```json
{
  "managerId": "uuid-du-manager",
  "propertyIds": ["uuid-prop-1", "uuid-prop-2"]
}
```

#### Règles métier

- `ownerId` doit correspondre à l'utilisateur connecté
- Le manager cible doit avoir le rôle `MANAGER`
- Les propriétés doivent appartenir à l'owner

---

### 3.9 `DELETE /users/:ownerId/delegations/:managerId`

**🔐 OWNER uniquement** · Révoque toutes les délégations vers ce manager sur ses propriétés.

---

## 4. Agencies

**Base path** : `/agencies`  
**Authentification** : Varie par endpoint

### Objectif métier
Gestion des agences immobilières et de leurs membres. Une agence regroupe des MANAGERs qui gèrent des propriétés via des mandats.

### 4.1 `POST /agencies` — Créer une agence

**🔐 ADMIN uniquement**

#### Corps

```json
{
  "name": "Immo Pro Douala",
  "email": "contact@immopro.cm",
  "phone": "+237600000001",
  "address": "Bonanjo, Douala",
  "rccm": "DLA/2024/001"
}
```

#### Réponse `201`

```json
{
  "data": {
    "id": "uuid",
    "name": "Immo Pro Douala",
    "email": "contact@immopro.cm",
    "phone": "+237600000001",
    "address": "Bonanjo, Douala",
    "rccm": "DLA/2024/001",
    "status": "ACTIVE",
    "createdAt": "2026-06-16T07:00:00.000Z"
  },
  "statusCode": 201,
  "timestamp": "..."
}
```

---

### 4.2 `POST /agencies/search`

**🔐 ADMIN uniquement** · Liste paginée des agences.

**Filtres disponibles** : `status` (`ACTIVE`, `SUSPENDED`)  
**Recherche** : `name`  
**Tri** : `createdAt`

---

### 4.3 `PATCH /agencies/:id/suspend`

**🔐 ADMIN uniquement** · Suspend une agence.

#### Réponse `200`

```json
{ "data": { "id": "uuid", "status": "SUSPENDED", ... }, "statusCode": 200, "timestamp": "..." }
```

#### Erreurs

| Code | Cause |
|------|-------|
| `404` | Agence introuvable |

---

### 4.4 `POST /agencies/:id/members`

**🔐 ADMIN ou membre ADMIN de l'agence** · Ajoute un MANAGER à l'agence.

#### Corps

```json
{
  "userId": "uuid-du-manager",
  "role": "MEMBER"
}
```

| `role` | Description |
|--------|-------------|
| `MEMBER` | Membre standard |
| `ADMIN` | Peut ajouter d'autres membres |

#### Erreurs

| Code | `error` | Cause |
|------|---------|-------|
| `403` | `ForbiddenException` | Requérant non ADMIN global ni ADMIN de l'agence |
| `404` | `NotFoundException` | Agence ou utilisateur introuvable |
| `409` | `ConflictException` | Manager déjà membre de l'agence |
| `422` | `UnprocessableEntityException` | L'utilisateur n'a pas le rôle MANAGER |

---

### 4.5 `DELETE /agencies/:id/members/:memberId`

**🔐 ADMIN ou ADMIN de l'agence** · Retire un membre.

---

### 4.6 `GET /agencies/:id/public`

**Public** · Profil public d'une agence (avec count des propriétés gérées actives).

#### Réponse `200`

```json
{
  "data": {
    "id": "uuid",
    "name": "Immo Pro Douala",
    "address": "Bonanjo, Douala",
    "phone": "+237600000001",
    "email": "contact@immopro.cm",
    "managedPropertiesCount": 12
  },
  "statusCode": 200,
  "timestamp": "..."
}
```

> 💡 `managedPropertiesCount` = nombre de mandats `ACTIVE` vers des propriétés publiées. Réponse mise en cache 30 minutes.

---

## 5. Properties

**Base path** : `/properties`  
**Authentification** : Varie

### Objectif métier
CRUD des biens immobiliers, gestion des images/documents, publication, et recherche publique.

### Types de propriétés (`PropertyType`)

`APARTMENT` · `VILLA` · `OFFICE` · `HOUSE` · `LAND` · `COMMERCIAL` · `BUILDING`

### Statuts (`PropertyStatus`)

`AVAILABLE` · `RENTED` · `MAINTENANCE` · `RESERVED`

---

### 5.1 `GET /properties`

**Public** · Liste les propriétés publiées avec filtres.

#### Query parameters

| Param | Type | Description |
|-------|------|-------------|
| `city` | `string` | Ville |
| `neighborhood` | `string` | Quartier |
| `type` | `PropertyType` | Type de bien |
| `status` | `PropertyStatus` | Statut |
| `minPrice` | `number` | Prix min (FCFA) |
| `maxPrice` | `number` | Prix max (FCFA) |
| `minArea` | `number` | Surface min (m²) |
| `maxArea` | `number` | Surface max (m²) |
| `bedrooms` | `number` | Nombre de chambres |
| `search` | `string` | Recherche textuelle |
| `sort` | `string` | Champ de tri |
| `page` | `number` | Page (défaut: 1) |
| `limit` | `number` | Par page (défaut: 20) |

> 💡 Réponse mise en cache 5 minutes.

---

### 5.2 `GET /properties/:slug`

**Public** · Détail d'une propriété par slug.

> 💡 Réponse mise en cache 5 minutes.

---

### 5.3 `GET /properties/dashboard/list`

**🔐 OWNER / MANAGER / ADMIN** · Liste les propriétés du tableau de bord (propriétés gérées ou possédées).

Query params : identiques à `GET /properties`

---

### 5.4 `POST /properties`

**🔐 OWNER / MANAGER / ADMIN** · Crée une propriété.

#### Corps

```json
{
  "title": "Villa Bastos F4",
  "type": "VILLA",
  "city": "Yaoundé",
  "neighborhood": "Bastos",
  "address": "Rue des Ambassadeurs, n°12",
  "latitude": 3.8841,
  "longitude": 11.5127,
  "price": 350000,
  "area": 180.5,
  "bedrooms": 4,
  "bathrooms": 2,
  "floor": 0,
  "description": "Belle villa avec jardin...",
  "status": "AVAILABLE"
}
```

| Champ | Type | Requis | Contraintes |
|-------|------|--------|-------------|
| `title` | `string` | ✅ | |
| `type` | `PropertyType` | ✅ | |
| `city` | `string` | ✅ | |
| `neighborhood` | `string` | ✅ | |
| `address` | `string` | ✅ | |
| `latitude` | `number` | ❌ | |
| `longitude` | `number` | ❌ | |
| `price` | `integer` | ✅ | ≥ 0, en FCFA |
| `area` | `number` | ✅ | ≥ 0, en m² |
| `bedrooms` | `integer` | ❌ | |
| `bathrooms` | `integer` | ❌ | |
| `floor` | `integer` | ❌ | |
| `description` | `string` | ❌ | |
| `status` | `PropertyStatus` | ❌ | Défaut: `AVAILABLE` |

#### Réponse `201`

```json
{
  "data": {
    "id": "uuid",
    "title": "Villa Bastos F4",
    "slug": "villa-bastos-f4",
    "type": "VILLA",
    "city": "Yaoundé",
    "neighborhood": "Bastos",
    "price": 350000,
    "area": 180.5,
    "bedrooms": 4,
    "bathrooms": 2,
    "status": "AVAILABLE",
    "isPublished": false,
    "ownerId": "uuid-owner",
    "images": [],
    "createdAt": "2026-06-16T07:00:00.000Z"
  },
  "statusCode": 201,
  "timestamp": "..."
}
```

> ⚠️ La propriété est créée avec `isPublished: false`. Elle n'apparaît pas dans la liste publique tant qu'elle n'est pas publiée.

---

### 5.5 `PATCH /properties/:id`

**🔐 OWNER / MANAGER / ADMIN** · Met à jour une propriété (tous les champs optionnels).

---

### 5.6 `PATCH /properties/:id/publish`

**🔐 OWNER / MANAGER / ADMIN** · Publie ou dépublie.

#### Corps

```json
{ "isPublished": true }
```

---

### 5.7 `PATCH /properties/:id/status`

**🔐 OWNER / MANAGER / ADMIN** · Met à jour le statut.

#### Corps

```json
{ "status": "MAINTENANCE" }
```

---

### 5.8 `DELETE /properties/:id`

**🔐 OWNER / ADMIN** · Soft delete (propriété masquée).

---

### 5.9 `POST /properties/:id/images`

**🔐 OWNER / MANAGER / ADMIN** · Upload jusqu'à 4 images.

```
Content-Type: multipart/form-data
```

| Champ | Type | Contraintes |
|-------|------|-------------|
| `images` | `File[]` | Max 4 fichiers, JPEG/PNG |

> ⚠️ **État actuel** : Retourne des URLs placeholder. Les images ne sont pas encore stockées sur un CDN réel.

---

### 5.10 `PATCH /properties/:id/images/:imageId/cover`

**🔐 OWNER / MANAGER / ADMIN** · Définit une image comme photo principale.

---

### 5.11 `DELETE /properties/:id/images/:imageId`

**🔐 OWNER / MANAGER / ADMIN** · Supprime une image.

---

### 5.12 `POST /properties/:id/documents`

**🔐 OWNER / MANAGER / ADMIN** · Upload jusqu'à 10 documents (PDF, Word...).

```
Content-Type: multipart/form-data
```

| Champ | Type | Contraintes |
|-------|------|-------------|
| `documents` | `File[]` | Max 10 fichiers |

---

## 6. Tenants

**Base path** : `/tenants`  
**Authentification** : JWT requis

### Objectif métier
Gestion des dossiers locataires liés aux propriétés. Un `Tenant` est un dossier qui peut être relié à un `User` (compte) ou exister de façon indépendante.

### 6.1 `POST /tenants/search`

**🔐 OWNER / MANAGER / ADMIN** · Liste paginée des locataires.

**Filtres** : `city`, `createdAt` (date-range)  
**Recherche** : `firstName`, `lastName`, `email`

---

### 6.2 `POST /tenants`

**🔐 OWNER / MANAGER** · Crée un dossier locataire.

#### Corps

```json
{
  "firstName": "Alice",
  "lastName": "Ngo",
  "email": "alice@example.com",
  "phone": "+237699000001",
  "nationalIdNumber": "12345678",
  "occupation": "Ingénieure",
  "income": 500000
}
```

| Champ | Type | Requis | Contraintes |
|-------|------|--------|-------------|
| `firstName` | `string` | ✅ | |
| `lastName` | `string` | ✅ | |
| `email` | `string` | ✅ | Email valide |
| `phone` | `string` | ✅ | Format `+237XXXXXXXXX` |
| `nationalIdNumber` | `string` | ✅ | |
| `occupation` | `string` | ✅ | |
| `income` | `integer` | ✅ | ≥ 0, en FCFA/mois |

---

### 6.3 `GET /tenants/me/payments`

**🔐 TENANT uniquement** · Liste les paiements du locataire connecté.

---

### 6.4 `GET /tenants/:id`

**🔐 OWNER / MANAGER / ADMIN** · Détail complet d'un locataire (avec contrats, paiements).

---

### 6.5 `PATCH /tenants/:id`

**🔐 OWNER / MANAGER / ADMIN** · Met à jour un dossier locataire.

---

### Candidatures (Applications)

Les candidatures publiques transitent par `/applications`. Les candidatures depuis le tableau de bord sont également accessibles via :

- `POST /properties/:slug/applications` — Soumission publique d'une candidature
- `GET /properties/:id/applications` — Liste des candidatures d'une propriété
- `PATCH /properties/:id/applications/:appId` — Met à jour le statut

---

## 7. Leases (Contrats)

**Base path** : `/contracts`  
**Authentification** : JWT requis

### Objectif métier
Gestion du cycle de vie complet des baux : création, paiements automatiques, renouvellement, résiliation. Un contrat lie une propriété à un locataire.

### Statuts (`ContractStatus`)

`ACTIVE` · `EXPIRED` · `TERMINATED` · `RENEWAL`

---

### 7.1 `POST /contracts/search`

**🔐 JWT requis** · Résultats filtrés par rôle automatiquement.

**Filtres** : `status`, `propertyId`, `tenantId`  
**Recherche** : non  
**Tri** : `startDate`, `endDate`, `createdAt`

---

### 7.2 `POST /contracts`

**🔐 OWNER / MANAGER / ADMIN** · Crée un bail et génère automatiquement les échéances de paiement.

#### Corps

```json
{
  "propertyId": "uuid-propriete",
  "tenantId": "uuid-locataire",
  "startDate": "2026-07-01",
  "endDate": "2027-06-30",
  "rent": 250000,
  "fees": 0,
  "deposit": 500000,
  "clauses": [
    "Interdit de sous-louer sans accord écrit",
    "Animaux domestiques non autorisés"
  ]
}
```

| Champ | Type | Requis | Contraintes |
|-------|------|--------|-------------|
| `propertyId` | `UUID` | ✅ | |
| `tenantId` | `UUID` | ✅ | |
| `startDate` | `YYYY-MM-DD` | ✅ | |
| `endDate` | `YYYY-MM-DD` | ✅ | Doit être > `startDate` |
| `rent` | `integer` | ✅ | ≥ 0, en FCFA |
| `fees` | `integer` | ❌ | ≥ 0, en FCFA |
| `deposit` | `integer` | ✅ | ≥ 0, en FCFA (caution) |
| `clauses` | `string[]` | ❌ | Clauses spéciales |

#### Réponse `201`

```json
{
  "data": {
    "id": "uuid",
    "propertyId": "uuid",
    "tenantId": "uuid",
    "startDate": "2026-07-01T00:00:00.000Z",
    "endDate": "2027-06-30T00:00:00.000Z",
    "rent": 250000,
    "fees": 0,
    "deposit": 500000,
    "status": "ACTIVE",
    "clauses": [...],
    "createdAt": "2026-06-16T07:00:00.000Z"
  },
  "statusCode": 201,
  "timestamp": "..."
}
```

#### Effets de bord automatiques

- Propriété mise à `status: RENTED`
- Échéancier de paiements mensuel créé automatiquement (de `startDate` à `endDate`)
- Notification au locataire

#### Règles métier

- La propriété doit être en statut `AVAILABLE` ou `RESERVED`
- Aucun contrat `ACTIVE` ne doit déjà exister pour cette propriété
- Le locataire doit exister dans le système

---

### 7.3 `GET /contracts/:id`

**🔐 JWT requis** · Détail d'un contrat avec clauses.

---

### 7.4 `POST /contracts/:id/renewal`

**🔐 OWNER / MANAGER / ADMIN** · Renouvelle un bail actif.

#### Corps

```json
{
  "endDate": "2028-06-30",
  "rent": 275000,
  "clauses": ["Clause mise à jour"]
}
```

#### Effets de bord

- Ancien contrat passe à `status: RENEWAL`
- Nouveau contrat créé avec `parentContractId = ancien.id`
- Nouvel échéancier de paiements généré

---

### 7.5 `POST /contracts/:id/termination`

**🔐 OWNER / MANAGER / ADMIN** · Résilie un bail.

#### Corps

```json
{
  "terminationDate": "2026-12-31",
  "reason": "Déménagement du locataire",
  "depositRefund": 450000
}
```

#### Effets de bord

- Contrat passe à `status: TERMINATED`
- Propriété passe à `status: AVAILABLE`
- Remboursement de caution enregistré si `depositRefund > 0`

---

### 7.6 `GET /contracts/:id/pdf`

**🔐 JWT requis** · URL du PDF du contrat.

#### Query params

| Param | Type | Description |
|-------|------|-------------|
| `force` | `boolean` | Force la régénération |

#### Réponse `200`

```json
{ "data": { "url": "https://cdn.r2.dev/contracts/uuid.pdf", "expiresAt": "..." }, "statusCode": 200, "timestamp": "..." }
```

> ⚠️ **État actuel** : La génération PDF asynchrone (BullMQ) n'est pas encore active. L'URL peut être temporairement indisponible.

---

### 7.7 `POST /contracts/:id/receipts`

**🔐 OWNER / MANAGER / ADMIN** · Génère des reçus de paiement.

#### Corps

```json
{ "period": "2026-07" }
```

---

## 8. Payments (Paiements)

**Base path** : `/payments`  
**Authentification** : JWT requis

### Objectif métier
Suivi des paiements de loyer, enregistrement des paiements reçus, gestion des impayés, statistiques financières.

### Statuts (`PaymentStatus`)

`PENDING` · `PAID` · `LATE` · `CANCELLED`

### Méthodes de paiement (`PaymentMethod`)

`MOBILE_MONEY` · `TRANSFER` · `CASH` · `CARD`

---

### 8.1 `POST /payments/search`

**🔐 JWT requis** · Filtré automatiquement par rôle.

- **TENANT** : voit uniquement ses paiements
- **OWNER** : voit les paiements de ses propriétés
- **MANAGER** : voit les paiements des propriétés mandatées
- **ADMIN** : voit tout

**Filtres** : `status`, `contractId`, `propertyId`, `period`  
**Tri** : `dueDate`, `createdAt`

---

### 8.2 `POST /payments`

**🔐 OWNER / MANAGER / ADMIN** · Enregistre ou met à jour un paiement.

#### Corps

```json
{
  "contractId": "uuid-contrat",
  "period": "2026-07",
  "amount": 250000,
  "dueDate": "2026-07-01",
  "status": "PAID",
  "paymentDate": "2026-07-03",
  "paymentMethod": "MOBILE_MONEY",
  "reference": "OM-20260703-12345"
}
```

| Champ | Type | Requis | Description |
|-------|------|--------|-------------|
| `contractId` | `UUID` | ✅ | Identifiant du contrat |
| `period` | `string` | ✅ | Format `YYYY-MM` |
| `amount` | `integer` | ✅ | Montant en FCFA |
| `dueDate` | `YYYY-MM-DD` | ✅ | Date d'échéance |
| `status` | `PaymentStatus` | ✅ | |
| `paymentDate` | `YYYY-MM-DD` | ❌ | Date effective |
| `paymentMethod` | `PaymentMethod` | ❌ | |
| `reference` | `string` | ❌ | Référence transaction |

#### Effets de bord (si `status = PAID`)

- Génération automatique d'une commission pour les mandats actifs ayant une `commissionType`
- Calcul TVA (19.25%) inclus dans la commission

---

### 8.3 `PATCH /payments/:id`

**🔐 OWNER / MANAGER / ADMIN** · Mise à jour partielle d'un paiement.

#### Corps

```json
{
  "status": "PAID",
  "paymentMethod": "TRANSFER",
  "reference": "VIR-20260703"
}
```

---

### 8.4 `GET /payments/overdue`

**🔐 JWT requis** · Liste des paiements en retard filtrés par rôle.

---

### 8.5 `POST /payments/reminders`

**🔐 OWNER / MANAGER / ADMIN** · Envoie des rappels aux locataires.

#### Corps

```json
{
  "paymentIds": ["uuid-1", "uuid-2"],
  "channel": "EMAIL"
}
```

`channel` : `EMAIL` · `SMS` · `BOTH`

> ⚠️ **État actuel** : L'envoi effectif via BullMQ n'est pas encore actif.

---

### 8.6 `GET /payments/stats`

**🔐 JWT requis** · Statistiques financières.

#### Query params

| Param | Type | Description |
|-------|------|-------------|
| `year` | `number` | Année (défaut: année courante) |
| `month` | `number` | Mois (1-12) |
| `propertyId` | `UUID` | Filtrer par propriété |

#### Réponse `200`

```json
{
  "data": {
    "totalCollected": 1250000,
    "totalPending": 500000,
    "totalLate": 250000,
    "byMonth": [...],
    "byProperty": [...]
  },
  "statusCode": 200,
  "timestamp": "..."
}
```

---

### 8.7 `GET /payments/:id/receipt`

**🔐 JWT requis** · URL du reçu de paiement PDF.

---

## 9. Maintenance

**Base path** : `/maintenance`  
**Authentification** : JWT requis

### Objectif métier
Gestion des demandes de maintenance immobilière. Les locataires signalent des problèmes, les propriétaires/gestionnaires les prennent en charge.

### Statuts

`OPEN` → `IN_PROGRESS` → `RESOLVED` → `CLOSED`

### Niveaux d'urgence (`MaintenanceUrgency`)

`LOW` · `NORMAL` · `HIGH` · `CRITICAL`

---

### 9.1 `GET /maintenance/my-requests`

**🔐 TENANT uniquement** · Mes demandes de maintenance.

---

### 9.2 `POST /maintenance/search`

**🔐 OWNER / MANAGER / ADMIN** · Liste paginée filtrée par rôle.

- **OWNER** : propriétés possédées
- **MANAGER** : propriétés mandatées
- **ADMIN** : toutes

**Filtres** : `status`, `urgency`, `propertyId`  
**Tri** : `createdAt`

---

### 9.3 `POST /maintenance`

**🔐 TENANT / OWNER / MANAGER / ADMIN** · Crée une demande.

#### Corps

```json
{
  "propertyId": "uuid-propriete",
  "title": "Fuite d'eau dans la cuisine",
  "description": "Le robinet principal fuit depuis 2 jours.",
  "urgency": "HIGH",
  "images": []
}
```

| Champ | Type | Requis |
|-------|------|--------|
| `propertyId` | `UUID` | ✅ |
| `title` | `string` | ✅ |
| `description` | `string` | ✅ |
| `urgency` | `MaintenanceUrgency` | ❌ (défaut: `NORMAL`) |
| `images` | `string[]` | ❌ |

#### Règles d'autorisation

| Rôle | Condition requise |
|------|-------------------|
| `TENANT` | Doit avoir un contrat `ACTIVE` sur la propriété |
| `OWNER` | Doit être le propriétaire de la propriété |
| `MANAGER` | Doit avoir un mandat actif sur la propriété |
| `ADMIN` | Toujours autorisé |

#### Effets de bord

- Notification au propriétaire
- Si `urgency = CRITICAL` : notification prioritaire (`maintenance_critical`)

---

### 9.4 `PATCH /maintenance/:id/status`

**🔐 TENANT / OWNER / MANAGER / ADMIN** · Met à jour le statut.

#### Corps

```json
{
  "status": "IN_PROGRESS",
  "comment": "Plombier contacté, intervention prévue demain."
}
```

#### Transitions autorisées

| Rôle | Transitions permises |
|------|----------------------|
| `OWNER` / `MANAGER` | `OPEN` → `IN_PROGRESS`, `IN_PROGRESS` → `RESOLVED`, `RESOLVED` → `CLOSED` |
| `TENANT` | `RESOLVED` → `CLOSED` (fermeture), `RESOLVED` → `OPEN` (réouverture) |
| `ADMIN` | Toutes les transitions |

> ⚠️ Un TENANT ne peut **pas** mettre `IN_PROGRESS`. Un OWNER ne peut **pas** fermer directement sans passer par `RESOLVED`.

---

### 9.5 `POST /maintenance/:id/photos`

**🔐 TENANT / OWNER / ADMIN** · Ajoute des photos.

```
Content-Type: multipart/form-data
```

| Champ | Contrainte |
|-------|-----------|
| `photos[]` | Max 3 fichiers par appel |

#### Règles

- TENANT : uniquement pour ses propres demandes
- OWNER : pour ses propriétés

---

## 10. Commissions

**Base path** : `/commissions`  
**Authentification** : JWT requis

### Objectif métier
Suivi des commissions dues aux agences/gestionnaires pour leurs services. Les commissions sont générées automatiquement lors d'un paiement ou créées manuellement.

### Types (`CommissionCategory`)

| Type | Description |
|------|-------------|
| `MANAGEMENT` | Générée automatiquement à chaque paiement reçu |
| `PLACEMENT` | Honoraires de mise en location (manuel) |
| `EXCEPTIONAL` | Service exceptionnel (manuel) |

### Statuts (`CommissionStatus`)

`PENDING` · `PAID` · `CANCELLED`

---

### 10.1 `GET /commissions/dashboard`

**🔐 MANAGER / ADMIN** · KPIs commissions.

---

### 10.2 `GET /commissions/my-due`

**🔐 OWNER uniquement** · Commissions en attente de paiement pour le propriétaire.

---

### 10.3 `POST /commissions/search`

**🔐 MANAGER / ADMIN** · Liste paginée.

---

### 10.4 `POST /commissions`

**🔐 MANAGER / ADMIN** · Crée une commission manuelle.

#### Corps

```json
{
  "contractId": "uuid-contrat",
  "mandateId": "uuid-mandat",
  "agencyId": "uuid-agence",
  "type": "PLACEMENT",
  "amountHT": 250000,
  "description": "Honoraires de mise en location"
}
```

#### Calcul TVA automatique

- `amountHT` = Montant hors taxe
- TVA = 19.25%
- `amountTTC` = `amountHT × 1.1925` (calculé côté serveur)

---

### 10.5 `POST /commissions/:id/pay`

**🔐 OWNER / ADMIN** · Marque une commission comme payée.

#### Corps

```json
{
  "paymentMethod": "TRANSFER",
  "reference": "VIR-COMMISSION-001"
}
```

---

### 10.6 `POST /commissions/:id/cancel`

**🔐 OWNER / ADMIN** · Annule une commission `PENDING`.

---

## 11. Mandates

**Base path** : `/mandates`  
**Authentification** : JWT requis

### Objectif métier
Un mandat lie une propriété à une agence et à un gestionnaire spécifique. Il autorise le gestionnaire à agir au nom du propriétaire.

### Statuts

`ACTIVE` · `TERMINATED` · `EXPIRED`

---

### 11.1 `POST /mandates/search`

**🔐 JWT requis** · Filtré par rôle.

- **OWNER** : ses mandates
- **MANAGER** : mandates où il est gestionnaire
- **ADMIN** : tous

**Filtres** : `status`, `propertyId`, `managerId`

---

### 11.2 `POST /mandates`

**🔐 OWNER / ADMIN** · Crée un mandat.

#### Corps

```json
{
  "propertyId": "uuid-propriete",
  "agencyId": "uuid-agence",
  "managerId": "uuid-manager",
  "startDate": "2026-07-01",
  "endDate": "2027-06-30",
  "commissionType": "PERCENTAGE",
  "commissionValue": 10,
  "description": "Gestion complète"
}
```

| Champ | Type | Requis |
|-------|------|--------|
| `propertyId` | `UUID` | ✅ |
| `agencyId` | `UUID` | ✅ |
| `managerId` | `UUID` | ✅ |
| `startDate` | `YYYY-MM-DD` | ✅ |
| `endDate` | `YYYY-MM-DD` | ❌ |
| `commissionType` | `PERCENTAGE` \| `FIXED` | ❌ |
| `commissionValue` | `number` | ❌ |

#### Effets de bord

- La propriété est liée au manager (`managerId`)
- Notification au manager

---

### 11.3 `POST /mandates/:id/terminate`

**🔐 OWNER / ADMIN** · Résilie un mandat.

#### Corps

```json
{ "reason": "Fin de collaboration" }
```

#### Effets de bord

- Mandat passe à `TERMINATED`
- `property.managerId` remis à `null`
- Notification au manager

---

## 12. Messages

**Base path** : `/messages`  
**Authentification** : JWT requis

### Objectif métier
Messagerie interne entre utilisateurs de la plateforme (propriétaires, locataires, gestionnaires).

---

### 12.1 `GET /messages/conversations`

**🔐 JWT requis** · Liste des conversations actives.

#### Réponse `200`

```json
{
  "data": {
    "conversations": [
      {
        "userId": "uuid-interlocuteur",
        "firstName": "Alice",
        "lastName": "Ngo",
        "lastMessage": "Bonjour, à propos du contrat...",
        "lastMessageAt": "2026-06-16T07:00:00.000Z",
        "unreadCount": 2
      }
    ]
  },
  "statusCode": 200,
  "timestamp": "..."
}
```

---

### 12.2 `GET /messages/:userId`

**🔐 JWT requis** · Messages échangés avec un utilisateur.

#### Query params

| Param | Défaut | Description |
|-------|--------|-------------|
| `page` | `1` | Page |
| `limit` | `20` | Par page |

---

### 12.3 `POST /messages`

**🔐 JWT requis** · Envoie un message.

#### Corps

```json
{
  "recipientId": "uuid-destinataire",
  "content": "Bonjour, j'ai une question concernant le loyer de juillet.",
  "attachmentUrl": null
}
```

---

### 12.4 `PATCH /messages/:conversationUserId/read`

**🔐 JWT requis** · Marque tous les messages d'une conversation comme lus.

---

### 12.5 `POST /messages/attachments`

**🔐 JWT requis** · Upload d'une pièce jointe.

> ⚠️ **État actuel** : Retourne une URL placeholder. Le stockage réel n'est pas encore implémenté.

---

## 13. Notifications

**Base path** : `/notifications`  
**Authentification** : JWT requis

### Objectif métier
Centre de notifications in-app pour chaque utilisateur. Supporte les préférences email/SMS et les alertes de paiement planifiées.

### Types de notifications

| Type | Déclencheur |
|------|-------------|
| `NEW_APPLICATION` | Nouvelle candidature pour une propriété |
| `maintenance_created` | Demande de maintenance créée |
| `maintenance_critical` | Demande urgence CRITICAL |
| `maintenance_status_updated` | Changement de statut maintenance |
| `payment_due` | Loyer à venir (CronService) |
| `payment_late` | Loyer en retard (CronService) |

---

### 13.1 `POST /notifications/search`

**🔐 JWT requis** · Mes notifications paginées.

**Tri** : `createdAt` (défaut: plus récentes d'abord)  
**Filtres** : `isRead` (`"true"` ou `"false"`)

---

### 13.2 `GET /notifications/count`

**🔐 JWT requis** · Nombre de notifications non lues.

#### Réponse `200`

```json
{ "data": { "count": 5 }, "statusCode": 200, "timestamp": "..." }
```

---

### 13.3 `PATCH /notifications/:id/read`

**🔐 JWT requis** · Marque une notification comme lue.

---

### 13.4 `PATCH /notifications/read-all`

**🔐 JWT requis** · Marque toutes les notifications comme lues.

---

### 13.5 `GET /notifications/preferences`

**🔐 JWT requis** · Récupère les préférences de notification.

#### Réponse `200`

```json
{
  "data": {
    "email": {
      "payment_due": true,
      "payment_late": true,
      "maintenance_created": true
    },
    "sms": {
      "payment_due": false,
      "payment_late": true
    }
  },
  "statusCode": 200,
  "timestamp": "..."
}
```

---

### 13.6 `PUT /notifications/preferences`

**🔐 JWT requis** · Mets à jour les préférences.

#### Corps

```json
{
  "email": { "payment_due": true, "payment_late": true },
  "sms": { "payment_late": false }
}
```

---

### 13.7 `PUT /notifications/payment-alerts`

**🔐 JWT requis** · Configure les alertes de paiement automatiques.

#### Corps

```json
{
  "daysBeforeDue": 3,
  "daysAfterDue": [1, 3, 7],
  "channel": "EMAIL"
}
```

---

## 14. Dashboard

**Base path** : `/dashboard`  
**Authentification** : JWT requis

### Objectif métier
KPIs et métriques spécifiques à chaque rôle pour les tableaux de bord.

---

### 14.1 `GET /dashboard/portfolio`

**🔐 OWNER / MANAGER / ADMIN** · KPIs du portefeuille immobilier.

#### Réponse type

```json
{
  "data": {
    "totalProperties": 15,
    "occupiedProperties": 12,
    "occupancyRate": 80.0,
    "totalMonthlyRent": 3750000,
    "pendingPayments": 2,
    "activeContracts": 12,
    "expiringContracts": 3
  },
  "statusCode": 200,
  "timestamp": "..."
}
```

---

### 14.2 `GET /dashboard/maintenance`

**🔐 OWNER / MANAGER / ADMIN** · KPIs maintenance.

#### Réponse type

```json
{
  "data": {
    "open": 5,
    "inProgress": 3,
    "resolved": 12,
    "critical": 1,
    "avgResolutionDays": 4.5
  },
  "statusCode": 200,
  "timestamp": "..."
}
```

---

### 14.3 `GET /dashboard/commissions`

**🔐 MANAGER uniquement** · Tableau de bord des commissions.

---

### 14.4 `GET /dashboard/admin`

**🔐 ADMIN uniquement** · Statistiques globales de la plateforme.

---

### 14.5 `GET /dashboard/stats`

**🔐 OWNER / MANAGER / ADMIN** · Statistiques générales de l'owner.

---

### 14.6 `GET /dashboard/tenant`

**🔐 TENANT uniquement** · Tableau de bord locataire (contrat actif, prochain paiement, maintenances).

---

## 15. Reports (Rapports)

**Base path** : `/reports`  
**Authentification** : JWT requis

### 15.1 `GET /reports/financial`

**🔐 OWNER / MANAGER / ADMIN** · Rapport financier sur une période.

#### Query params

| Param | Type | Description |
|-------|------|-------------|
| `startDate` | `YYYY-MM-DD` | Début de période |
| `endDate` | `YYYY-MM-DD` | Fin de période |
| `propertyId` | `UUID` | Filtrer par propriété |

#### Réponse `200`

```json
{
  "data": {
    "period": { "start": "2026-01-01", "end": "2026-06-30" },
    "grossRevenue": 15000000,
    "totalFees": 0,
    "netRevenue": 15000000,
    "byProperty": [
      { "propertyId": "uuid", "title": "Villa Bastos", "revenue": 1500000, "fees": 0 }
    ]
  },
  "statusCode": 200,
  "timestamp": "..."
}
```

---

### 15.2 `GET /reports/occupancy`

**🔐 JWT requis** · Taux d'occupation par propriété sur une année.

#### Query params

| Param | Type | Description |
|-------|------|-------------|
| `year` | `number` | Année (défaut: année courante) |
| `propertyId` | `UUID` | Filtrer |

#### Réponse `200`

```json
{
  "data": {
    "globalRate": 75.0,
    "properties": [
      {
        "propertyId": "uuid",
        "title": "Villa Bastos",
        "rate": 83.3,
        "daysOccupied": 304,
        "daysVacant": 61
      }
    ]
  },
  "statusCode": 200,
  "timestamp": "..."
}
```

---

### 15.3 `POST /reports/export`

**🔐 OWNER / MANAGER / ADMIN** · Lance un export PDF asynchrone.

#### Corps

```json
{
  "type": "financial",
  "startDate": "2026-01-01",
  "endDate": "2026-06-30",
  "propertyId": "uuid"
}
```

#### Réponse `202`

```json
{ "data": { "jobId": "uuid-job", "status": "pending" }, "statusCode": 202, "timestamp": "..." }
```

> ⚠️ **État actuel** : La génération PDF n'est pas encore active. Le statut restera `pending`.

---

### 15.4 `GET /reports/export/:jobId`

**🔐 JWT requis** · Vérifie le statut d'un export.

#### Réponse `200`

```json
{
  "data": {
    "jobId": "uuid",
    "status": "completed",
    "pdfUrl": "https://cdn.r2.dev/reports/uuid.pdf"
  },
  "statusCode": 200,
  "timestamp": "..."
}
```

| `status` | Description |
|----------|-------------|
| `pending` | En attente de traitement |
| `completed` | PDF disponible |
| `not_found` | Job inconnu |

---

### 15.5 `GET /reports/profitability/:propertyId`

**🔐 OWNER / MANAGER / ADMIN** · Analyse de rentabilité d'une propriété.

#### Query params

| Param | Type | Description |
|-------|------|-------------|
| `startDate` | `YYYY-MM-DD` | |
| `endDate` | `YYYY-MM-DD` | |

#### Réponse `200`

```json
{
  "data": {
    "property": { "id": "uuid", "title": "Villa Bastos" },
    "cumulativeRevenue": 3000000,
    "cumulativeFees": 0,
    "avgMonthlyCashFlow": 250000,
    "roi": null
  },
  "statusCode": 200,
  "timestamp": "..."
}
```

---

## 16. Admin

**Base path** : `/admin`  
**Authentification** : ADMIN uniquement

---

### 16.1 `GET /admin/stats`

Statistiques globales de la plateforme.

---

### 16.2 `GET /admin/settings`

Paramètres de configuration.

---

### 16.3 `PUT /admin/settings`

#### Corps

```json
{ "maintenanceMode": false, "maxUploadSizeMb": 10 }
```

---

### 16.4 `GET /admin/users`

Liste des utilisateurs avec filtres.

#### Query params

| Param | Type | Description |
|-------|------|-------------|
| `page` | `number` | Page |
| `limit` | `number` | Par page |
| `role` | `Role` | Filtrer par rôle |
| `isActive` | `boolean` | Filtrer par statut |
| `search` | `string` | Recherche textuelle |

---

### 16.5 `PATCH /admin/users/:id/deactivate`

Désactive un compte utilisateur.

---

## 17. Guides pratiques

### Guide 1 — Connexion d'un utilisateur

```
Étape 1: POST /auth/login
  Body: { email, password }
  → Si 401 EMAIL_NOT_VERIFIED → aller Étape A

Étape A (si email non vérifié):
  POST /auth/resend-otp { userId } ← récupéré du premier POST /auth/register
  Afficher écran de saisie OTP

Étape B: POST /auth/verify-email { userId, otp }
  → Récupère { accessToken, refreshToken, user }

Étape 2: Stocker accessToken + refreshToken

Étape 3: Toutes les requêtes suivantes:
  Header: Authorization: Bearer <accessToken>

Étape 4 (expiration): POST /auth/refresh { refreshToken }
  → Nouveaux tokens (rotation automatique)
  → Mettre à jour le stockage local
```

---

### Guide 2 — Créer une propriété et la publier

```
Étape 1: POST /properties
  Body: { title, type, city, neighborhood, address, price, area, ... }
  → { id, slug, isPublished: false }

Étape 2 (optionnel): POST /properties/:id/images
  Content-Type: multipart/form-data
  Field: images[] (max 4 fichiers)

Étape 3: PATCH /properties/:id/publish
  Body: { isPublished: true }
  → Propriété visible publiquement
```

---

### Guide 3 — Signer un bail (Leases)

```
Prérequis:
  - Propriété en statut AVAILABLE
  - Locataire créé (POST /tenants)

Étape 1: POST /contracts
  Body: {
    propertyId, tenantId,
    startDate: "2026-07-01",
    endDate: "2027-06-30",
    rent: 250000,
    deposit: 500000
  }
  → Contrat créé, échéancier généré, propriété → RENTED

Étape 2 (optionnel): GET /contracts/:id/pdf
  → URL du PDF du contrat
```

---

### Guide 4 — Enregistrer un paiement de loyer

```
Étape 1: POST /payments/search
  Body: { filters: { contractId: ["uuid"], status: ["PENDING"] } }
  → Trouver le paiement de la période

Étape 2: POST /payments
  Body: {
    contractId: "uuid",
    period: "2026-07",
    amount: 250000,
    dueDate: "2026-07-01",
    status: "PAID",
    paymentDate: "2026-07-03",
    paymentMethod: "MOBILE_MONEY",
    reference: "OM-20260703-12345"
  }
  → Paiement enregistré + commission générée automatiquement
```

---

### Guide 5 — Soumettre une candidature (locataire)

```
Étape 1 (public): GET /properties?city=Yaoundé
  → Trouver une propriété, noter son slug

Étape 2 (public): POST /applications
  Headers: aucun JWT requis
  Body: {
    propertyId: "uuid",
    firstName: "Alice",
    lastName: "Ngo",
    email: "alice@example.com",
    phone: "+237699000001",
    message: "Je suis intéressée."
  }
  → { applicationId, status: "PENDING" }
  ⚠️ Limité à 5 candidatures / heure par IP
```

---

### Guide 6 — Gérer une demande de maintenance

```
Rôle TENANT:
Étape 1: POST /maintenance
  Body: { propertyId, title, description, urgency: "HIGH" }
  ⚠️ Requiert un contrat ACTIVE sur la propriété

Rôle OWNER/MANAGER:
Étape 2: POST /maintenance/search
  → Voir les demandes ouvertes

Étape 3: PATCH /maintenance/:id/status
  Body: { status: "IN_PROGRESS", comment: "Plombier convoqué" }

Étape 4: PATCH /maintenance/:id/status
  Body: { status: "RESOLVED", comment: "Réparation effectuée" }

Rôle TENANT (fermeture):
Étape 5: PATCH /maintenance/:id/status
  Body: { status: "CLOSED" }
```

---

### Guide 7 — Rafraîchir les tokens automatiquement (Intercepteur)

<details>
<summary>Axios — Intercepteur de rafraîchissement automatique</summary>

```javascript
// api.js
import axios from 'axios';

const api = axios.create({ baseURL: 'https://api.immoplus.cm' });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true;
      const refreshToken = localStorage.getItem('refreshToken');
      const { data } = await axios.post('/auth/refresh', { refreshToken });
      const { accessToken, refreshToken: newRefresh } = data.data;
      localStorage.setItem('accessToken', accessToken);
      localStorage.setItem('refreshToken', newRefresh);
      original.headers.Authorization = `Bearer ${accessToken}`;
      return api(original);
    }
    return Promise.reject(error);
  }
);

export default api;
```
</details>

<details>
<summary>Flutter/Dio — Intercepteur de rafraîchissement automatique</summary>

```dart
class AuthInterceptor extends Interceptor {
  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    final token = secureStorage.read(key: 'accessToken');
    if (token != null) {
      options.headers['Authorization'] = 'Bearer $token';
    }
    handler.next(options);
  }

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) async {
    if (err.response?.statusCode == 401) {
      final refreshToken = await secureStorage.read(key: 'refreshToken');
      try {
        final response = await Dio().post(
          '${ApiConfig.baseUrl}/auth/refresh',
          data: {'refreshToken': refreshToken},
        );
        final data = response.data['data'];
        await secureStorage.write(key: 'accessToken', value: data['accessToken']);
        await secureStorage.write(key: 'refreshToken', value: data['refreshToken']);
        
        // Retry original request
        err.requestOptions.headers['Authorization'] = 'Bearer ${data['accessToken']}';
        final retried = await Dio().fetch(err.requestOptions);
        return handler.resolve(retried);
      } catch (_) {
        // Force logout
        handler.reject(err);
      }
    }
    handler.next(err);
  }
}
```
</details>

---

### Guide 8 — Pagination et recherche

<details>
<summary>Exemple complet — Rechercher des propriétés avec filtre + tri</summary>

```javascript
// Axios
const searchProperties = async (page = 0) => {
  const { data } = await api.post('/properties/dashboard/list', {
    pageNumber: page,
    pageSize: 20,
    searchKey: 'villa',
    filters: {
      status: ['AVAILABLE'],
      city: ['Yaoundé']
    },
    sortClauses: [
      { fieldName: 'createdAt', direction: 'DESC' }
    ]
  });
  
  const { data: items, meta } = data.data;
  // meta: { total, pageNumber, pageSize, totalPages }
  return { items, meta };
};
```

```dart
// Flutter/Dio
Future<Map<String, dynamic>> searchProperties(int page) async {
  final response = await dio.post('/properties/dashboard/list', data: {
    'pageNumber': page,
    'pageSize': 20,
    'filters': { 'status': ['AVAILABLE'] },
    'sortClauses': [{ 'fieldName': 'createdAt', 'direction': 'DESC' }],
  });
  final payload = response.data['data'];
  final items = payload['data'] as List;
  final meta = payload['meta'] as Map;
  return {'items': items, 'meta': meta};
}
```
</details>

---

## Annexe A — Récapitulatif des endpoints par méthode HTTP

| Méthode | Pattern | Usage |
|---------|---------|-------|
| `GET` | `/module` | Liste publique (properties, agencies/:id/public) |
| `GET` | `/module/:id` | Détail d'une ressource |
| `POST` | `/module` | Création |
| `POST` | `/module/search` | **Recherche / liste paginée** |
| `PATCH` | `/module/:id` | Mise à jour partielle |
| `PATCH` | `/module/:id/action` | Action spécifique (publish, suspend, read...) |
| `POST` | `/module/:id/action` | Action avec corps (terminate, renewal, pay...) |
| `DELETE` | `/module/:id` | Suppression (soft) |

---

## Annexe B — Codes d'erreur machine

| Code machine | Module | Déclencheur |
|-------------|--------|-------------|
| `EMAIL_ALREADY_EXISTS` | Auth | Email en doublon |
| `OTP_INVALID` | Auth | OTP expiré ou utilisé |
| `EMAIL_NOT_VERIFIED` | Auth | Connexion sans vérification |
| `REFRESH_TOKEN_INVALID` | Auth | Token révoqué |
| `PROPERTY_NOT_FOUND` | Properties/Maintenance | Propriété introuvable |
| `TENANT_NOT_FOUND` | Maintenance | Locataire introuvable |
| `NO_ACTIVE_CONTRACT` | Maintenance | TENANT sans contrat actif |
| `NO_ACTIVE_MANDATE` | Mandates/Apps/Payments | MANAGER sans mandat actif |
| `NOT_PROPERTY_OWNER` | Various | Tentative d'accès non autorisé |
| `NOT_REQUEST_CREATOR` | Maintenance | TENANT essaie de modifier demande d'un autre |
| `TENANT_CANNOT_SET_STATUS` | Maintenance | TENANT essaie de mettre IN_PROGRESS |
| `INVALID_TRANSITION` | Maintenance | Transition de statut invalide |
| `MANAGER_ALREADY_IN_AGENCY` | Agencies | Manager déjà membre |
| `APPLICATION_NOT_FOUND` | Applications | Candidature introuvable |
| `MAINTENANCE_NOT_FOUND` | Maintenance | Demande introuvable |
| `AGENCY_NOT_FOUND` | Agencies | Agence introuvable |
| `VALIDATION_ERROR` | All | Données invalides (class-validator) |
| `INTERNAL_SERVER_ERROR` | All | Erreur serveur inattendue |

---

## Annexe C — Champs filtrables par module

| Module | `filters` disponibles | Type |
|--------|----------------------|------|
| Users | `role`, `isActive` | exact, boolean |
| Properties (dashboard) | `status`, `type`, `city` | exact |
| Tenants | `city` | exact |
| Contracts | `status`, `propertyId`, `tenantId` | exact |
| Payments | `status`, `contractId`, `propertyId` | exact |
| Maintenance | `status`, `urgency`, `propertyId` | exact |
| Mandates | `status`, `propertyId`, `managerId` | exact |
| Agencies | `status` | exact |
| Commissions | `status`, `contractId` | exact |
| Applications | `propertyId`, `status` | exact |
| Notifications | `isRead` | boolean |

---

*Document généré automatiquement à partir du code source NestJS · Immo Plus CM Backend*
