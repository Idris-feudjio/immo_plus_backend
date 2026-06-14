---
title: Immo Plus CM — Hardening & Completion (Phase 3)
status: draft
created: 2026-06-14
updated: 2026-06-14
parent_prd: ../prd-immo-plus-backend-2026-06-12/prd.md
oq_status: all_resolved
---

# Immo Plus CM — Hardening & Completion (Phase 3)

## 0. Document Purpose

This PRD captures new requirements discovered during the June 2026 technical audit of the Immo Plus CM codebase (`AUDIT.md`). It complements the Phase 1–2 PRD (`prd-immo-plus-backend-2026-06-12`) which defined FR-1 through FR-45.

**FR IDs in this document start at FR-46** and are globally unique across both PRDs.

**Trigger**: The audit surfaced 4 critical security gaps, 6 high-priority issues, and 10 medium findings across 22 modules. The backend is feature-complete for Phase 2 but not yet safe or complete enough for real-tenant traffic.

---

## 1. Vision

Harden the Immo Plus CM backend from a feature-complete state into a production-ready platform. Three pillars:

1. **Security** — eliminate all critical and high-severity findings before the first real tenant is onboarded.
2. **Completeness** — wire up file storage, input validation, and calculation logic that currently exist as stubs in the codebase.
3. **Trust** — configurable business constants, reliable email delivery, and test coverage sufficient to ship with confidence.

This PRD does not add new user-facing workflows. It makes existing workflows correct, safe, and observable.

---

## 2. Features & Functional Requirements

### 2.1 Sécurité & Contrôle d'Accès

**FR-46 — Livraison sécurisée des OTP et liens de réinitialisation**

Les codes OTP et les liens de réinitialisation de mot de passe sont actuellement écrits dans les logs via `console.log`. Ils doivent être délivrés via le canal email transactionnel (BullMQ → `EmailQueueService`).

- FR-46.1 — `AuthService.sendOtp()` enqueue un job email via `EmailQueueService`. Aucune valeur OTP n'apparaît dans aucune ligne de log.
- FR-46.2 — `AuthService.sendPasswordResetLink()` enqueue un job email. Aucune URL de réinitialisation n'apparaît dans les logs.
- FR-46.3 — En l'absence de variables `SMTP_*`, le job est enqueué et silencieusement ignoré plutôt que de fuir vers stdout.

*Audit source: C1 — `auth.service.ts:68`*

---

**FR-47 — Couverture RBAC sur tous les endpoints mutants**

Chaque endpoint qui crée, modifie ou supprime une ressource doit porter un décorateur `@Roles(...)` explicite, en plus du `JwtAuthGuard` global. Les endpoints identifiés sans guard lors de l'audit doivent être corrigés.

- FR-47.1 — `DELETE /agencies/:id/members/:memberId` exige `Role.OWNER` ou `Role.ADMIN`.
- FR-47.2 — Chaque `@Delete`, `@Post`, `@Patch`, `@Put` dans tous les contrôleurs porte soit `@Roles(...)` soit `@Public()`. Aucune route mutante n'est implicitement accessible à tout utilisateur authentifié.

*Audit source: C2 — `agencies.controller.ts`*

---

**FR-48 — Normalisation de l'adresse email**

Les adresses email doivent être stockées et comparées en minuscules pour prévenir les doublons de compte ne différant que par la casse.

- FR-48.1 — À l'inscription (`AuthService.register()`), `dto.email` est converti en minuscules avant la persistance.
- FR-48.2 — À la connexion (`AuthService.login()`), `dto.email` est converti en minuscules avant la requête base de données.
- FR-48.3 — Une migration normalise les emails existants en base. [ASSUMPTION A-B5]

*Audit source: H5 — `auth.service.ts`*

---

**FR-49 — Protection anti-bot sur les formulaires publics**

Les endpoints publics de candidature locative (`POST /applications` et `POST /tenants/:slug/applications`) sont accessibles sans authentification et exposés aux soumissions automatisées.

- FR-49.1 — Les deux endpoints intègrent une vérification **Cloudflare Turnstile** : le client envoie un token Turnstile dans le body de la requête ; le backend vérifie ce token via l'API `POST https://challenges.cloudflare.com/turnstile/v0/siteverify` avant de traiter la soumission. Requête sans token valide → HTTP 422.
- FR-49.2 — Un throttling renforcé est appliqué en défense en profondeur : maximum 5 soumissions par IP par heure. Dépassement → HTTP 429 avec header `Retry-After`.
- FR-49.3 — Les clés Turnstile (`TURNSTILE_SECRET_KEY`, `TURNSTILE_SITE_KEY`) sont injectées via variables d'environnement.

*Audit source: H3 — Décision experte OQ-A2 : Cloudflare Turnstile (même vendor que R2, invisible, privacy-first)*

---

### 2.2 Gestion des Fichiers

**FR-50 — Upload d'images de propriété vers R2**

Les images de propriété uploadées via `POST /properties/:id/images` sont actuellement persistées avec des URLs factices. Le `StorageService` doit être appelé pour stocker les buffers dans Cloudflare R2.

- FR-50.1 — `PropertiesController.addImages()` appelle `StorageService.uploadBuffer(key, buffer, contentType)` pour chaque image et stocke l'URL retournée.
- FR-50.2 — La suppression d'image déclenche `StorageService.delete(key)`.
- FR-50.3 — Convention de clé R2 : `properties/{propertyId}/images/{imageId}.{ext}`.
- FR-50.4 — L'URL de couverture est accessible via `GET /properties/:id` et `GET /properties/:slug`.

*Audit source: C4 — `properties.controller.ts:125`*

---

**FR-51 — Upload de photos de maintenance vers R2**

Les photos jointes aux demandes de maintenance ont le même problème d'URLs factices.

- FR-51.1 — `MaintenanceController.uploadPhotos()` appelle `StorageService.uploadBuffer()` pour chaque fichier et stocke les URLs retournées.
- FR-51.2 — Convention de clé R2 : `maintenance/{requestId}/photos/{photoId}.{ext}`.

*Audit source: C4 — `maintenance.controller.ts:82`*

---

**FR-52 — Validation MIME et taille sur tous les uploads**

Tous les endpoints d'upload de fichier doivent rejeter les fichiers dont le type MIME ou la taille dépasse les limites définies, avant toute tentative de stockage.

- FR-52.1 — Types MIME autorisés pour les images : `image/jpeg`, `image/png`, `image/webp`. Toute autre valeur → HTTP 415.
- FR-52.2 — Taille maximale des images : 5 Mo. Dépassement → HTTP 413. [ASSUMPTION A-B3]
- FR-52.3 — Types MIME autorisés pour les documents (contrats, reçus) : `application/pdf`. Taille max : 10 Mo. [ASSUMPTION A-B3]
- FR-52.4 — La validation s'exécute avant tout appel à `StorageService.uploadBuffer()`.
- FR-52.5 — Un `FileValidationPipe` centralisé est utilisé sur tous les contrôleurs concernés.

*Audit source: C3 — tous les contrôleurs avec `FileInterceptor`*

---

### 2.3 Intégrité des Données

**FR-53 — Validation de la plage de dates de contrat**

La création d'un contrat doit imposer que `startDate` soit strictement antérieure à `endDate`.

- FR-53.1 — `ContractsService.create()` lève `BadRequestException` si `startDate >= endDate`.
- FR-53.2 — Message d'erreur : `"La date de début doit être antérieure à la date de fin."`.

*Audit source: M8*

---

**FR-54 — Contrainte d'unicité sur la période de paiement**

La table `Payment` doit imposer l'unicité sur `(contractId, period)` pour éviter les entrées dupliquées dans l'échéancier.

- FR-54.1 — Une migration Prisma ajoute `@@unique([contractId, period])` au modèle `Payment`.
- FR-54.2 — `buildPaymentSchedule()` dans `ContractsService` continue de fonctionner correctement après l'ajout de la contrainte.
- FR-54.3 — Toute tentative d'insertion dupliquée remonte une `ConflictException` (HTTP 409), pas une erreur brute de base de données.

*Audit source: H6 — schéma Prisma*

---

### 2.4 Configuration Métier

**FR-55 — Taux de TVA configurable dans AdminSettings**

Le taux de TVA (actuellement hardcodé à 19,25 %) doit être lisible depuis `AdminSettings` pour pouvoir être ajusté sans redéploiement en cas de changement réglementaire au Cameroun.

- FR-55.1 — `AdminSettings` stocke un champ `tvaRate` (décimal, valeur par défaut 19,25).
- FR-55.2 — `CommissionsService` lit `tvaRate` depuis `AdminSettings` au moment de la création de la commission et stocke ce taux en snapshot dans la colonne `tvaRate` de `Commission`.
- FR-55.3 — L'endpoint `PATCH /admin/settings` accepte `{ tvaRate: number }` avec validation de plage [0, 100].
- FR-55.4 — La modification du taux **recalcule les commissions dont le statut est `PENDING`** : `tvaAmount` et `amountTTC` sont mis à jour avec le nouveau taux ; `tvaRate` (snapshot) est également mis à jour. Les commissions `PAID` et `CANCELLED` ne sont **jamais** modifiées rétroactivement.
- FR-55.5 — L'assumption A-7 du PRD parent est fermée : 19,25 % est la valeur par défaut valide ; la configurabilité garantit la flexibilité réglementaire.

*Audit source: H1 — `contracts.service.ts`, `commissions.service.ts` ; Assumption parente A-7*

---

### 2.5 Communication

**FR-56 — Templates d'email transactionnel avec identité visuelle**

Les emails transactionnels (OTP, réinitialisation de mot de passe, confirmation de paiement, création de contrat, mise à jour de maintenance) doivent utiliser des templates HTML structurés cohérents avec l'identité visuelle d'Immo Plus CM.

- FR-56.1 — Chaque type d'email dispose d'un template HTML dédié dans `src/notifications/templates/`.
- FR-56.2 — Les templates sont responsives (mobile-first), incluent le logo Immo Plus CM, la couleur primaire de la marque, et un footer avec les coordonnées de contact. [ASSUMPTION A-B6, voir OQ-A3]
- FR-56.3 — `NotificationsProcessor` injecte les variables contextuelles (nom du locataire, montant, date, etc.) dans les templates avant l'envoi.
- FR-56.4 — Les lignes d'objet sont en français.
- FR-56.5 — Chaque message multipart inclut une version texte brut de repli.

*Audit source: H2 — `notifications.processor.ts`*

---

### 2.6 Calculs Analytiques

**FR-57 — Calcul des charges par propriété**

Le stub `DocumentsService.calculateFees()` doit implémenter le calcul réel des charges (coûts de maintenance, montants de commissions) sur une propriété.

- FR-57.1 — `calculateFees(propertyId, from, to)` retourne le total des charges sur la période : coûts de maintenance, commissions de placement, commissions de gestion, total.
- FR-57.2 — Exposé via `GET /documents/fees?propertyId={id}&from={date}&to={date}` (Owner/Admin uniquement).
- FR-57.3 — Le résultat est ventilé par catégorie de charge.

*Audit source: TODO `documents.service.ts:38`*

---

**FR-58 — Calcul du ROI d'une propriété**

Le stub `DocumentsService.calculateRoi()` doit implémenter le calcul du retour sur investissement.

- FR-58.1 — `calculateRoi(propertyId, purchasePrice)` calcule le ROI annualisé = (revenus nets annuels / prix d'achat) × 100.
- FR-58.2 — Revenus nets = total des paiements PAID − total des charges (FR-57).
- FR-58.3 — Exposé via `GET /documents/roi?propertyId={id}&purchasePrice={amount}` (Owner uniquement).

*Audit source: TODO `documents.service.ts:135`*

---

## 3. Exigences Non-Fonctionnelles

**NFR-7 — Aucune donnée sensible dans les logs applicatifs**

Les logs applicatifs ne doivent contenir ni codes OTP, ni tokens de réinitialisation, ni secrets JWT, ni credentials de base de données. Cette règle s'applique à l'ensemble du codebase, nouveau et existant, et est directement enforced par FR-46.

---

**NFR-8 — Sécurité des types TypeScript**

Aucun cast `as never` ni `as any` dans les chemins de code de production. Tous les résultats de requêtes Prisma doivent être typés via des formes `select` explicites ou des types de retour déclarés. Cette règle s'applique au nouveau code et aux quatre fichiers signalés par l'audit : `tenants.service.ts`, `messages.service.ts`, `dashboard.service.ts`, `documents.service.ts`.

*Audit source: H4*

---

**NFR-9 — Couverture de tests des services critiques**

Les tests unitaires doivent couvrir les méthodes de service suivantes à ≥ 80 % de couverture de branches avant déploiement en production. [ASSUMPTION A-B4, voir OQ-A4]

| Service | Priorité |
|---------|---------|
| `AuthService` | Critique |
| `UsersService` | Haute |
| `NotificationsService` | Moyenne |
| `CacheService` | Moyenne |
| `StorageService` | Moyenne |

Les tests d'intégration doivent couvrir les flux end-to-end suivants :

- Inscription → vérification OTP → connexion → mise à jour du profil
- Création propriété → upload d'images → publication → accès par slug
- Création contrat → paiement enregistré → commission générée → reçu téléchargé
- Soumission candidature publique → traitement back-office

*Audit source: Missing test coverage section*

---


## 4. Scope & Priorités Phase 3

| Priorité | FRs / NFRs | Justification |
|----------|-----------|---------------|
| **P1 — Avant tout trafic réel** | FR-46, FR-47, FR-48, FR-49, FR-52, NFR-7 | Findings critiques et hauts exposant des données ou permettant des actions non autorisées |
| **P2 — Compléter les flux core** | FR-50, FR-51, FR-53, FR-54 | Le système est fonctionnellement incomplet sans upload réel et sans contraintes de données |
| **P3 — Maturité opérationnelle** | FR-55, FR-56, NFR-8, NFR-9 | Configurabilité, qualité et fiabilité requises avant montée en charge |
| **P4 — Profondeur analytique** | FR-57, FR-58 | Valeur ajoutée pour les propriétaires ; pas de dépendance bloquante |

---

## 5. Non-Goals

- **Livraison SMS** : confirmée différée à v2 (D-9 du PRD parent). La queue SMS reste enregistrée pour compatibilité ascendante, aucun consumer n'est implémenté.
- **Scoring de dossier locataire** : différé à v2 (D-12 du PRD parent).
- **Pagination cursor-based** : M4 de l'audit, différée — offset pagination acceptable à l'échelle Phase 3.
- **Journal d'audit AdminSettings** : M5 de l'audit, différé à v2.
- **Pièces jointes aux messages** : TODO `messages.controller.ts:62` — implémentation différée, hors périmètre Phase 3.
- **Dead Letter Queue (DLQ) email** : NFR-10, différée à v2. BullMQ retry par défaut (3 tentatives) est maintenu ; inspection et replay via Redis CLI manuel en Phase 3.

---

## 6. Questions Ouvertes

Toutes les questions ouvertes sont résolues.

| ID | Question | Décision | Statut |
|----|----------|----------|--------|
| OQ-A1 | TVA : modification rétroactive sur PENDING ? | **Oui** — commissions PENDING recalculées ; PAID/CANCELLED intouchables | Résolu |
| OQ-A2 | Anti-bot : throttler seul ou CAPTCHA ? | **Cloudflare Turnstile** (décision experte — même vendor R2, invisible, privacy-first) | Résolu |
| OQ-A3 | Assets de marque pour templates email ? | **Oui** — fournis par Idris avant implémentation FR-56 | Résolu |
| OQ-A4 | Seuil de couverture de tests ? | **80 % de branches** confirmé | Résolu |
| OQ-A5 | DLQ Phase 3 : BullMQ Board ou Redis CLI ? | **Hors scope Phase 3** — différé à v2 | Résolu |

---

## 7. Index des Hypothèses

| ID | Hypothèse | Statut |
|----|-----------|--------|
| A-B1 | FR-49 : Cloudflare Turnstile retenu (OQ-A2 résolu) | **Fermé** |
| A-B2 | FR-55 : modification du taux TVA = rétroactive sur PENDING uniquement (OQ-A1 résolu) | **Fermé** |
| A-B3 | FR-52 : taille max images = 5 Mo, taille max documents = 10 Mo | Ouvert (à confirmer avant implémentation) |
| A-B4 | NFR-9 : 80 % de couverture de branches (OQ-A4 résolu) | **Fermé** |
| A-B5 | FR-48 : la migration de normalisation des emails existants est sans risque (aucun lookup externe ne dépend de la casse) | Ouvert |
| A-B6 | FR-56 : les assets de marque (logo, couleurs, polices) seront fournis par Idris avant l'implémentation (OQ-A3 résolu) | **Fermé** |
| A-B7 | NFR-10 (DLQ) hors scope Phase 3 — BullMQ retry 3× maintenu ; Redis CLI pour inspection manuelle si besoin (OQ-A5 résolu) | **Fermé** |
