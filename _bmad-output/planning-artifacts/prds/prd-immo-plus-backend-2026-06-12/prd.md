---
title: "Immo Plus CM — Plateforme de Gestion Immobilière"
status: draft
created: 2026-06-12
updated: 2026-06-14
oq_status: all_resolved
project: immo-plus-backend
author: John (BMAD PM)
---

# PRD: Immo Plus CM

## 0. Document Purpose

Ce PRD s'adresse aux équipes produit, design, architecture et développement de la plateforme **Immo Plus CM**. Il décrit les exigences fonctionnelles et non-fonctionnelles de la version **MVP** de la plateforme, en s'appuyant sur le contexte métier Camerounais et la base de code NestJS existante. Le glossaire §3 définit le vocabulaire canonique — toutes les FRs, UJs et SMs l'utilisent verbatim. Les décisions d'architecture (schéma Prisma, endpoints REST) vivent dans `addendum.md`.

---

## 1. Vision

**Immo Plus CM** est la première plateforme SaaS de gestion immobilière conçue pour le marché camerounais. Elle centralise en un seul outil la gestion des biens, des locataires, des contrats, des paiements, des maintenances, des agences immobilières et de leurs commissions — éliminant les carnets papier, les tableurs Excel fragmentés et les relances manuelles qui coûtent aux propriétaires et agences camerounaises des dizaines d'heures par mois.

La plateforme s'adresse à deux profils complémentaires : les **propriétaires privés** qui gèrent un petit portefeuille de biens en direct, et les **agences immobilières** qui administrent des portefeuilles pour le compte de tiers. Dans les deux cas, la promesse est identique : *zéro loyer oublié, zéro contrat expiré sans alerte, zéro commission non tracée*.

À terme, Immo Plus CM devient la couche d'infrastructure sur laquelle reposent les transactions immobilières formelles au Cameroun — point de rencontre entre propriétaires, gestionnaires, locataires et institutionnels (banques, notaires, administrations).

---

## 2. Objectifs Métier

| # | Objectif | KPI Cible (M+12) | Mesure |
|---|----------|-----------------|--------|
| OB-1 | Réduire le taux d'impayés des utilisateurs actifs | < 8 % de loyers en retard | `PaymentStatus.LATE / total payments` |
| OB-2 | Automatiser la génération des quittances | 100 % des paiements PAID génèrent une quittance PDF | Comptage quittances vs paiements PAID |
| OB-3 | Accélérer la mise en location | Délai moyen propriété AVAILABLE → RENTED < 21 jours | `Contract.startDate - Property.createdAt` |
| OB-4 | Fidéliser les agences partenaires | ≥ 30 agences actives à M+12 | Agences avec ≥ 1 contrat actif |
| OB-5 | Tracer 100 % des commissions | Zéro commission sans enregistrement | Audit log Commission |
| OB-6 | Réduire le délai de traitement des maintenances critiques | < 48 h pour `urgency = CRITICAL` | `MaintenanceRequest.updatedAt - createdAt` |

---

## 2. Target User

### 2.1 Personas

#### P-1 — Amadou, propriétaire privé

- **Profil :** 45 ans, cadre moyen à Douala, 3 appartements en location. Gestion en direct, pas d'agence.
- **Jobs To Be Done :**
  - Savoir en temps réel qui a payé et qui doit encore payer.
  - Recevoir une alerte automatique avant l'expiration d'un bail.
  - Envoyer des quittances sans se déplacer.
  - Garder une trace légale des contrats et des documents.
- **Frustrations actuelles :** Relances téléphoniques chronophages, carnets de suivi perdus, contrats manuscrits non retrouvables.

#### P-2 — Clarisse, gestionnaire d'agence

- **Profil :** 33 ans, responsable d'une agence immobilière de 5 agents à Yaoundé. Portefeuille : 80 biens, 60 contrats actifs.
- **Jobs To Be Done :**
  - Piloter l'ensemble du portefeuille via un seul tableau de bord.
  - Automatiser la génération des échéanciers de paiement.
  - Facturer et tracer les commissions dues par les propriétaires.
  - Gérer les demandes de maintenance sans passer par WhatsApp.
- **Frustrations actuelles :** Reporting manuel en fin de mois, litiges commission non documentés, perte de bail lors du turnover d'agents.

#### P-3 — Éric, locataire

- **Profil :** 28 ans, jeune professionnel, locataire depuis 2 ans. Mobile-first.
- **Jobs To Be Done :**
  - Visualiser son contrat et ses quittances de loyer à tout moment.
  - Signaler une panne ou un problème de maintenance directement depuis son téléphone.
  - Recevoir une confirmation de paiement immédiatement.
- **Frustrations actuelles :** Ne sait pas si le virement a été reçu, doit appeler pour obtenir une quittance.

#### P-4 — Admin Système

- **Profil :** Équipe Immo Plus CM, accès total.
- **Jobs To Be Done :**
  - Superviser l'ensemble des comptes et résoudre les litiges.
  - Configurer les paramètres globaux de la plateforme (TVA, clauses par défaut, délais d'alerte).
  - Générer des rapports de revenus et d'activité.

### 2.2 Non-Users (MVP)

- Acheteurs / vendeurs de biens (marché de la vente immobilière hors scope MVP)
- Notaires et avocats (intégration légale formelle — v2)
- Banques et établissements de crédit (domiciliation de loyers — v2)
- Touristes / locations courte durée (Airbnb-style — hors scope)

### 2.3 User Journeys

**UJ-1. Amadou publie son premier bien et signe un contrat.**
- **Persona + contexte :** Amadou veut louer son appartement F3 à Akwa, Douala.
- **Entry state :** Compte créé, email vérifié, rôle OWNER.
- **Path :** (1) Crée la propriété (type, adresse, prix, surface). (2) Upload 3 photos. (3) Publie le bien (`isPublished = true`). (4) Sélectionne un locataire existant ou crée un nouveau profil Tenant. (5) Crée un contrat (dates, loyer, dépôt, clauses).
- **Climax :** Le contrat est ACTIVE, la propriété passe en RENTED, l'échéancier de paiements est généré automatiquement.
- **Resolution :** Amadou reçoit une notification de confirmation. Éric (le locataire) reçoit une notification "Nouveau contrat".
- **Edge case :** Si la propriété a déjà un contrat actif, le système renvoie `PROPERTY_NOT_AVAILABLE`.

**UJ-2. Clarisse traite un impayé et envoie une relance.**
- **Persona + contexte :** Clarisse pilote 60 contrats actifs depuis le tableau de bord agence.
- **Entry state :** Authentifiée, rôle MANAGER.
- **Path :** (1) Ouvre le widget "Paiements en retard" du dashboard. (2) Filtre par propriété. (3) Consulte le dossier du locataire. (4) Marque un paiement comme PAID après vérification du virement. (5) Génère et envoie la quittance par email.
- **Climax :** Le paiement passe en PAID, la quittance PDF est disponible immédiatement.
- **Resolution :** Éric reçoit un email avec le PDF. Clarisse voit le tableau de bord mis à jour en temps réel.

**UJ-3. Éric signale une panne et suit sa résolution.**
- **Persona + contexte :** Éric a un robinet qui fuit, urgence NORMAL.
- **Entry state :** Authentifié, rôle TENANT.
- **Path :** (1) Ouvre "Mes maintenances". (2) Crée une demande (titre, description, urgence NORMAL, photo optionnelle). (3) Suit le statut OPEN → IN_PROGRESS → RESOLVED.
- **Climax :** Le statut passe à RESOLVED, Éric reçoit une notification.
- **Resolution :** Éric peut clôturer la demande (CLOSED) ou la rouvrir si le problème persiste.

**UJ-4. Clarisse facture une commission à Amadou.**
- **Persona + contexte :** L'agence de Clarisse a mis en relation Amadou avec un locataire et perçoit 1 mois de loyer de commission.
- **Entry state :** Contrat actif entre la propriété d'Amadou et un locataire.
- **Path :** (1) Ouvre le contrat. (2) Crée une entrée Commission (type: PLACEMENT, montant: 1 mois de loyer, statut: PENDING). (3) Amadou reçoit une notification. (4) Amadou confirme le paiement. (5) Clarisse marque la commission PAID.
- **Climax :** La commission est tracée, un reçu est généré.
- **Resolution :** Le tableau de bord agence affiche le revenu de commission du mois.

---

## 3. Glossaire

- **Bien / Property** — Unité immobilière gérée sur la plateforme. Types : APARTMENT, VILLA, OFFICE, HOUSE, LAND, COMMERCIAL, BUILDING.
- **Propriétaire / Owner** — Utilisateur possédant des biens. Rôle : OWNER.
- **Gestionnaire / Manager** — Utilisateur mandaté par un propriétaire pour gérer ses biens. Rôle : MANAGER. Rattaché à une Agence.
- **Locataire / Tenant** — Personne physique ayant ou ayant eu un contrat de location. Rôle : TENANT.
- **Agence / Agency** — Personne morale regroupant un ou plusieurs Gestionnaires.
- **Contrat / Contract** — Bail liant une Property à un Tenant pour une période définie. Statuts : ACTIVE, EXPIRED, TERMINATED, RENEWAL.
- **Paiement / Payment** — Échéance mensuelle de loyer. Statuts : PAID, PENDING, LATE, CANCELLED. Méthodes : MOBILE_MONEY, TRANSFER, CASH, CARD.
- **Commission** — Rémunération due à une Agence pour un service rendu (placement, gestion). Liée à un Contrat.
- **Maintenance** — Demande de travaux ou de réparation. Urgences : LOW, NORMAL, HIGH, CRITICAL. Statuts : OPEN, IN_PROGRESS, RESOLVED, CLOSED.
- **Quittance** — Document PDF attestant du paiement d'une échéance. Associée à un Payment PAID.
- **Echéancier** — Ensemble des Payments générés automatiquement à la création d'un Contrat.
- **Dashboard** — Interface analytique présentant les indicateurs clés (KPIs) du portefeuille.
- **Slug** — Identifiant URL lisible d'un Bien, auto-généré à la création (`{titre}-{uuid8}`).
- **FCFA** — Franc CFA (XAF), devise de référence de la plateforme.
- **TVA** — Taux configuré dans AdminSettings (défaut : 19,25 %, applicable au Cameroun).
- **Mandat de gestion** — Contrat de délégation entre un Owner et une Agence pour un ou plusieurs Biens. Porte les paramètres de commission (type, taux ou montant fixe). Un Bien peut être sous plusieurs Mandats simultanément (mandats non exclusifs).
- **Candidature / Application** — Demande soumise par un prospect (Visiteur ou Tenant) via le portail public pour louer un Bien ou demander une visite. Statuts : PENDING, ACCEPTED, REJECTED.

---

## 4. Features & Functional Requirements

### 4.1 Gestion des Utilisateurs & Authentification

**Description :** Gestion du cycle de vie des comptes utilisateurs. L'authentification utilise JWT (access token court) + refresh token (UUID, 30 jours). L'inscription nécessite une vérification email par OTP 6 chiffres (15 min). Chaque utilisateur a un rôle unique (ADMIN, OWNER, MANAGER, TENANT, VISITOR). Réalise UJ-1, UJ-2, UJ-3, UJ-4.

**Functional Requirements :**

#### FR-1 : Inscription avec vérification email

Un Visiteur peut créer un compte en fournissant prénom, nom, email, téléphone (optionnel), mot de passe et rôle souhaité. Le système envoie un OTP 6 chiffres valide 15 minutes.

**Consequences :**
- Le compte est créé avec `emailVerified = false` et `isActive = true`.
- 3 tentatives OTP en 10 min déclenchent un blocage temporaire avec message `"Trop de tentatives"`.
- OTP expiré ou invalide retourne `OTP_INVALID`.
- Email déjà utilisé retourne `EMAIL_ALREADY_EXISTS` (HTTP 409).

#### FR-2 : Connexion et gestion de session

Un Utilisateur peut se connecter avec email + mot de passe et reçoit un access token (durée configurable, défaut 15 min) et un refresh token (30 jours).

**Consequences :**
- Email non vérifié retourne `EMAIL_NOT_VERIFIED` (HTTP 401).
- Compte désactivé retourne HTTP 401.
- Le refresh token est un UUID stocké en base (pas un JWT).
- Le refresh révoque l'ancien token et en génère un nouveau (rotation).

#### FR-3 : Réinitialisation du mot de passe

Un Utilisateur peut demander un lien de réinitialisation par email. Le token expire après 1 heure.

**Consequences :**
- La réponse est identique qu'un compte existe ou non (anti-enumeration).
- Token déjà utilisé ou expiré retourne HTTP 400.

#### FR-4 : Gestion du profil

Un Utilisateur authentifié peut modifier ses informations (nom, téléphone, avatar) et changer son mot de passe en fournissant le mot de passe actuel.

**Acceptance Criteria :**
- Avatar uploadé sur Cloudflare R2 via StorageService.
- `bcrypt` salt rounds = 12 pour tous les hachages.

#### FR-39 : Listing des utilisateurs (Admin)

Un Admin peut lister l'ensemble des utilisateurs de la plateforme avec pagination et filtres.

**Endpoint :** `GET /api/admin/users`

**Consequences :**
- Paramètres de pagination : `page` (défaut 1) et `limit` (défaut 10, max 100).
- La réponse inclut `{ data, total, page, limit }`.
- Filtres optionnels : `role` (valeur de l'enum Role), `isActive` (booléen), `search` (recherche insensible à la casse sur `firstName`, `lastName`, `email` en OR).
- `passwordHash` n'est **jamais** retourné dans aucune réponse.
- Tri par défaut : `createdAt` DESC.

#### FR-40 : Désactivation d'un utilisateur (Admin)

Un Admin peut désactiver un compte utilisateur spécifique.

**Endpoint :** `PATCH /api/admin/users/:id/deactivate`

**Consequences :**
- Met `isActive` à `false` et retourne l'utilisateur mis à jour (HTTP 200, sans `passwordHash`).
- Utilisateur inexistant → HTTP 404 (`USER_NOT_FOUND`).
- Les deux endpoints FR-39 et FR-40 exigent le rôle ADMIN.

---

### 4.2 Gestion des Propriétés

**Description :** Création, publication et administration du cycle de vie des biens immobiliers. Un bien peut être créé par un Owner ou un Admin. Un Manager peut gérer les biens qui lui sont délégués. Chaque bien a un slug unique auto-généré. Un bien ne peut être supprimé que s'il n'a pas de contrat actif (soft-delete). Réalise UJ-1.

**Functional Requirements :**

#### FR-5 : Création d'un bien

Un Owner (ou Admin) peut créer un bien en fournissant : titre, type, ville, quartier, adresse, prix (FCFA), surface, chambres (optionnel), salles de bain (optionnel), description.

**Consequences :**
- Slug auto-généré : `{titre-slugifié}-{8 premiers chars UUID}`.
- `priceLabel` auto-calculé : `"{prix} FCFA/mois"` (format `fr-FR`).
- `status` initial : AVAILABLE. `isPublished` initial : `false`.

#### FR-6 : Publication d'un bien

Un Owner (ou Admin) peut publier ou dépublier un bien.

**Consequences :**
- Publication impossible si 0 image associée → retourne `MAX_IMAGES_REACHED` [ASSUMPTION: le message d'erreur sera clarifiée — le code dit `"Le bien doit avoir au moins 1 image"`].
- Un bien publié est visible via l'endpoint public `/api/properties`.

#### FR-7 : Gestion des médias (images & documents)

Un Owner peut ajouter jusqu'à 4 images et des documents à un bien. La première image devient automatiquement la couverture si aucune n'est définie.

**Consequences :**
- Limite stricte : 4 images max → retourne `MAX_IMAGES_REACHED` (HTTP 409) au-delà.
- La suppression de la couverture transfère automatiquement le statut à la prochaine image.
- Images uploadées sur Cloudflare R2, URL publique stockée en base.
- Images redimensionnées via `sharp` (thumbnail).

#### FR-8 : Statut et cycle de vie d'un bien

Un Owner (ou Admin) peut modifier manuellement le statut d'un bien (AVAILABLE, MAINTENANCE, RESERVED). Le statut RENTED est géré automatiquement par la création de contrat.

**Consequences :**
- Passage manuel vers RENTED interdit pour les non-ADMIN → retourne HTTP 403.
- Suppression d'un bien avec contrat actif → retourne `PROPERTY_HAS_ACTIVE_CONTRACT`.
- La suppression est un soft-delete (`deletedAt = now()`).

#### FR-9 : Listing et recherche

Un Utilisateur authentifié peut lister les biens selon son rôle (ADMIN : tous, OWNER : ses biens, MANAGER : biens sous Mandat actif). Un Visiteur peut consulter les biens publiés via l'endpoint public.

**Consequences :**
- Filtres disponibles : ville, quartier, type, statut, chambres, fourchette de prix, fourchette de surface.
- Tri disponible : prix ASC/DESC, date de création ASC/DESC.
- Pagination : `pageSize` max 100, défaut 20. `pageNumber` est 0-based en interne.
- Recherche textuelle sur titre, description, adresse.

#### FR-36 : Candidature locative / demande de visite (portail public)

Un Visiteur peut soumettre une Candidature sur un Bien publié via un formulaire simplifié : nom, prénom, email, téléphone, message optionnel. Réalise UJ-1 (phase prospect).

**Consequences :**
- Une entité `Application` est créée avec `status = PENDING`.
- L'Owner (ou Manager mandaté) reçoit une notification in-app et email.
- La Candidature est consultable et traitable depuis le back-office (PENDING → ACCEPTED ou REJECTED).
- Un Visiteur sans compte peut soumettre — aucune authentification requise pour ce formulaire.
- Le scoring, la vérification documentaire et la conversion automatique en Tenant sont hors scope MVP.

**Out of Scope (MVP) :**
- Scoring de solvabilité automatique.
- Upload de documents justificatifs.
- Conversion automatique Candidature → Tenant + Contrat.

---

### 4.3 Gestion des Locataires

**Description :** Un Locataire (Tenant) est un profil distinct d'un User. Il peut être lié à un compte User (locataire inscrit) ou exister uniquement comme profil de référence créé par un Owner. Chaque Tenant est rattaché à son Owner créateur. Réalise UJ-1, UJ-2, UJ-3.

**Functional Requirements :**

#### FR-10 : Création d'un profil locataire

Un Owner peut créer un profil Tenant avec : nom, prénom, email, téléphone, numéro de pièce d'identité, profession, revenu mensuel.

**Consequences :**
- Un Tenant peut être associé à un User existant via `userId` (liaison optionnelle).
- Un User ne peut avoir qu'un seul profil Tenant (`userId` unique dans la table).

#### FR-11 : Consultation du dossier locataire

Un Owner (ou Admin) peut consulter le dossier complet d'un Tenant : informations personnelles, contrats, historique de paiements.

**Acceptance Criteria :**
- L'historique inclut tous les contrats (actifs, expirés, résiliés) liés au Tenant.
- Accessible uniquement par l'Owner créateur ou l'Admin.

#### FR-12 : Listing et recherche de locataires

Un Owner peut lister et rechercher ses Tenants (nom, email, numéro d'identité).

---

### 4.4 Gestion des Contrats

**Description :** Un Contrat lie un Bien à un Tenant pour une période définie. Sa création génère automatiquement l'échéancier de paiements et passe le bien en RENTED. Le renouvellement crée un nouveau contrat lié au précédent via `parentContractId`. Réalise UJ-1, UJ-2, UJ-4.

**Functional Requirements :**

#### FR-13 : Création d'un contrat

Un Owner ou Manager (autorisé sur ce bien) peut créer un Contrat actif avec : propertyId, tenantId, date de début, date de fin, loyer mensuel (FCFA), frais (FCFA), dépôt de garantie, clauses personnalisées.

**Consequences :**
- Exécuté dans une transaction atomique (UnitOfWork) : création contrat + passage bien en RENTED + génération échéancier + notification locataire.
- Bien doit être AVAILABLE ou RESERVED — sinon `PROPERTY_NOT_AVAILABLE`.
- Un seul contrat ACTIVE par bien à la fois — sinon HTTP 409.
- L'échéancier génère un Payment PENDING par mois, du `startDate` au `endDate`, avec `dueDate` au 5 du mois courant.
- Le montant de chaque Payment = `rent + fees`.

#### FR-14 : Consultation et listing des contrats

Un Owner ou Manager peut lister et consulter ses contrats avec filtres (statut, propriété, locataire).

#### FR-15 : Renouvellement d'un contrat

Un Owner ou Manager peut renouveler un contrat ACTIVE ou EXPIRED. Un nouveau contrat ACTIVE est créé avec `parentContractId` référençant le contrat précédent.

**Consequences :**
- L'ancien contrat passe en RENEWAL.
- La date de début du nouveau contrat = `endDate + 1 jour`.
- Un nouvel échéancier est généré.

#### FR-16 : Résiliation d'un contrat

Un Owner ou Manager peut résilier un contrat ACTIVE en précisant une date de résiliation.

**Consequences :**
- Le contrat passe en TERMINATED.
- Les Payments PENDING après la date de résiliation passent en CANCELLED.
- Le bien repasse en AVAILABLE.
- Le locataire reçoit une notification.
- Exécuté dans une transaction atomique.

#### FR-17 : Génération PDF du contrat

Un Owner peut générer et télécharger le PDF d'un contrat en réponse synchrone (< 3 s).

**Consequences :**
- Génération synchrone dans la requête HTTP — pas de BullMQ pour les contrats en MVP.
- Le PDF est uploadé sur Cloudflare R2 et l'URL est stockée dans `Contract.pdfUrl`.
- Si `pdfUrl` existe déjà, le système renvoie l'URL existante (pas de re-génération sauf si forçage).
- Mentions obligatoires : bailleur, locataire, adresse du bien, période, loyer HT, TVA (19,25 %), loyer TTC, dépôt de garantie, clauses.

---

### 4.5 Gestion des Paiements

**Description :** Les paiements sont créés automatiquement par l'échéancier contractuel. Un Owner ou Manager peut marquer un paiement comme PAID, enregistrer le mode de paiement et générer une quittance. Un cron job quotidien passe les paiements PENDING dont `dueDate < today` en LATE. Réalise UJ-2.

**Functional Requirements :**

#### FR-18 : Enregistrement d'un paiement

Un Owner ou Manager peut marquer un Payment PENDING ou LATE comme PAID en renseignant : méthode (MOBILE_MONEY, TRANSFER, CASH, CARD), référence, date de paiement.

**Consequences :**
- Le statut passe de PENDING/LATE à PAID.
- Une quittance PDF est générée synchroniquement et uploadée sur Cloudflare R2.
- Le locataire reçoit une notification email avec le lien vers la quittance PDF.
- Si un Mandat de gestion actif avec commission MANAGEMENT existe sur le bien, une entrée Commission est créée automatiquement dans la même transaction (voir FR-38).

#### FR-19 : Automatisation des retards

Un cron job tourne chaque jour à 00h01 et passe en LATE tous les Payments PENDING dont `dueDate < now()`.

**Consequences :**
- Aucune intervention manuelle requise.
- Log applicatif : `"Marked {n} payments as Late."`.

#### FR-20 : Alertes de paiement

Le système envoie des alertes avant et après échéance selon la configuration `PaymentAlertConfig` de l'Owner. Canal MVP : **EMAIL uniquement** (SMS différé en v2).

**Acceptance Criteria :**
- Délai par défaut : alerte 5 jours avant, puis J+1, J+3, J+7 après échéance.
- Désactivable par l'Owner via `PaymentAlertConfig.active = false`.
- Max 3 relances/mois/locataire pour éviter la saturation (counter-metric SM-C2).

#### FR-21 : Historique et reporting des paiements

Un Owner peut consulter l'historique complet des paiements avec filtres (statut, propriété, locataire, période).

#### FR-41 : Historique des paiements en libre-service (Tenant)

Un Tenant peut consulter la liste de ses propres paiements sans passer par un Owner ou Manager.

**Endpoint :** `GET /tenants/me/payments`

**Consequences :**
- Retourne uniquement les paiements liés aux contrats actifs ou passés du Tenant connecté.
- Accessible uniquement par le Tenant propriétaire des données (isolation par JWT).

#### FR-42 : Téléchargement de quittance (Tenant)

Un Tenant peut télécharger la quittance PDF d'un paiement qui lui appartient via une URL pré-signée.

**Endpoint :** `GET /payments/:id/receipt`

**Consequences :**
- Retourne une URL pré-signée Cloudflare R2 valable pour la durée configurée.
- Le Tenant ne peut accéder qu'aux quittances liées à ses propres contrats — toute tentative d'accès à une quittance tierce retourne HTTP 403.
- Le paiement doit avoir le statut PAID et une `receiptUrl` générée — sinon HTTP 404.

---

### 4.6 Gestion des Maintenances

**Description :** Un Tenant ou un Owner peut créer une demande de maintenance sur un bien. Les demandes sont suivies jusqu'à résolution. Réalise UJ-3.

**Functional Requirements :**

#### FR-22 : Création d'une demande de maintenance

Un Tenant (sur son bien loué) ou un Owner peut créer une demande avec : titre, description, urgence (LOW, NORMAL, HIGH, CRITICAL).

**Consequences :**
- Statut initial : OPEN.
- L'Owner du bien reçoit une notification immédiate.
- Urgence CRITICAL déclenche une notification additionnelle marquée prioritaire.
- Des photos peuvent être ajoutées après création via un endpoint dédié (`POST /maintenance/:id/photos`) qui upload les fichiers sur Cloudflare R2 et stocke les URLs publiques.

#### FR-23 : Gestion du cycle de vie d'une maintenance

Un Owner ou Manager peut faire progresser le statut : OPEN → IN_PROGRESS → RESOLVED. Le Tenant peut clôturer (RESOLVED → CLOSED) ou rouvrir (RESOLVED → OPEN).

**Consequences :**
- Chaque transition de statut génère une notification au Tenant.
- Un commentaire de résolution (`comment`) peut être ajouté.

#### FR-24 : Listing des maintenances

Un Owner peut lister les demandes de maintenance avec filtres (statut, urgence, bien).

---

### 4.7 Gestion des Agences Immobilières

**Description :** Une Agence est une personne morale regroupant un ou plusieurs Gestionnaires (Managers). Un Owner peut confier la gestion de ses biens à plusieurs Agences simultanément via des **Mandats de gestion non exclusifs** — un même bien peut être géré par plusieurs Agences en parallèle. Nouvelles entités à créer dans le schéma Prisma : `Agency`, `AgencyMember`, `Mandate`. Réalise UJ-4.

**Functional Requirements :**

#### FR-25 : Création et gestion d'une agence

Un Admin (ou un Owner s'auto-déclarant comme agence) peut créer une Agence avec : nom, email, téléphone, adresse. Le numéro RCCM est un champ optionnel — aucune validation KYC obligatoire en MVP.

**Consequences :**
- Une Agence a un statut : ACTIVE, SUSPENDED.
- Statut initial à la création : ACTIVE — activation immédiate, sans validation manuelle obligatoire.
- Seul l'Admin peut suspendre une agence.
- Un Owner peut consulter la liste des Agences actives pour les sélectionner lors de la création d'un Mandat.

#### FR-26 : Affectation d'un gestionnaire à une agence

Un Admin (ou le responsable de l'Agence) peut affecter un User (rôle MANAGER) à une Agence.

**Consequences :**
- Un Manager ne peut appartenir qu'à une seule Agence à la fois.
- L'affectation crée une entrée `AgencyMember` (agencyId, userId, role: MEMBER | ADMIN, joinedAt).
- Un Manager sans Agence ne peut pas créer de Mandat.

#### FR-27 : Mandat de gestion non exclusif (M:N)

Un Owner peut créer un Mandat de gestion confiant un Bien à une Agence (via un de ses Managers). Un même Bien peut avoir plusieurs Mandats actifs simultanément avec des Agences différentes (mandats non exclusifs).

**Consequences :**
- Un `Mandate` lie : `propertyId`, `agencyId`, `managerId`, dates de début/fin, statut (ACTIVE, TERMINATED), paramètres de commission (voir FR-37).
- Le Manager du Mandat acquiert les droits de gestion (contrats, paiements, maintenances) sur ce Bien pendant la durée du Mandat.
- L'Owner conserve la propriété et peut résilier un Mandat à tout moment (statut → TERMINATED).
- La résiliation d'un Mandat n'affecte pas les Contrats de location en cours — ils restent actifs.
- `Property.managerId` existant est conservé pour la compatibilité mais le Mandat devient la source de vérité des droits de gestion.

#### FR-37 : Paramètres de commission dans le mandat

Un Mandat porte les paramètres de commission MANAGEMENT applicable à chaque paiement de loyer encaissé.

**Consequences :**
- `commissionType` : `PERCENTAGE` (pourcentage du loyer) ou `FIXED` (montant fixe en FCFA).
- `commissionValue` : taux (ex : 5.0 pour 5 %) ou montant fixe (ex : 15000 FCFA).
- Ces paramètres déclenchent la génération automatique d'une Commission MANAGEMENT à chaque Payment PAID (voir FR-38).
- Le Mandat peut ne pas avoir de commission MANAGEMENT (champ optionnel — cas du Mandat simple sans honoraires de gestion récurrents).

#### FR-28 : Listing et profil public d'agence

Un Visiteur peut consulter le profil public d'une Agence (nom, nombre de biens gérés publiés, contact).

---

### 4.8 Gestion des Commissions

**Description :** Une Commission est une rémunération due à une Agence. Deux types coexistent : **PLACEMENT** (ponctuelle, à la signature du contrat, créée manuellement) et **MANAGEMENT** (récurrente, générée automatiquement à chaque encaissement de loyer selon les paramètres du Mandat). Des commissions exceptionnelles peuvent être créées manuellement par le Manager. Nouvelle entité `Commission` à créer dans le schéma Prisma, liée à `Contract` (N:1) et `Mandate` (N:1). Réalise UJ-4.

**Functional Requirements :**

#### FR-38 : Génération automatique de commission MANAGEMENT

Lors du passage d'un Payment en PAID (FR-18), si un Mandat actif avec `commissionType` défini existe sur le bien, le système crée automatiquement une Commission MANAGEMENT dans la même transaction atomique.

**Consequences :**
- Montant calculé selon le `commissionType` du Mandat : `PERCENTAGE` → `rent * commissionValue / 100` ; `FIXED` → `commissionValue`.
- Montant HT. TVA = 19,25 % calculée et stockée séparément (`commissionTVA`, `commissionTTC`).
- Statut initial : PENDING.
- L'Owner du bien reçoit une notification email avec le détail de la commission.
- Si plusieurs Mandats actifs existent sur le bien, une Commission est créée par Mandat (cas non-exclusif).

#### FR-29 : Création manuelle d'une commission

Un Manager peut créer manuellement une Commission liée à un Contrat : type (PLACEMENT ou EXCEPTIONAL), montant HT (FCFA), description, statut initial PENDING.

**Consequences :**
- Utilisable pour les commissions de placement (à la signature) et les frais exceptionnels.
- L'Owner lié au contrat reçoit une notification.
- La TVA (19,25 %) est calculée automatiquement sur le montant saisi.
- Toute commission créée est immuable après passage en PAID.

#### FR-30 : Validation et paiement d'une commission

Un Owner peut marquer une Commission PENDING comme PAID en renseignant la méthode de paiement et une référence.

**Consequences :**
- Statut passe de PENDING à PAID.
- Un reçu de commission PDF est généré synchroniquement et uploadé sur Cloudflare R2.
- La Commission ne peut plus être modifiée ni supprimée après PAID.
- Le Manager reçoit une notification de confirmation.

#### FR-31 : Reporting des commissions

Un Manager (ou Admin) peut consulter le tableau de bord des commissions : encaissées, en attente, par agence, par type, par période.

**Acceptance Criteria :**
- Export CSV disponible (Phase 3).
- Calcul automatique du CA commission mensuel de l'agence (HT + TVA + TTC).

#### FR-43 : Annulation d'une commission en attente

Un Owner ou un Admin peut annuler une Commission dont le statut est PENDING.

**Endpoint :** `POST /commissions/:id/cancel`

**Consequences :**
- Le statut passe de PENDING à CANCELLED.
- Une commission PAID est immuable — toute tentative d'annulation retourne HTTP 409.
- Le Manager lié à la commission reçoit une notification d'annulation.

#### FR-44 : Vue des commissions dues (Owner)

Un Owner peut consulter la liste des commissions qu'il doit aux agences, regroupées par agence.

**Endpoint :** `GET /commissions/my-due`

**Consequences :**
- Retourne uniquement les commissions liées aux biens de l'Owner connecté.
- Regroupement par agence avec sous-total PENDING par agence.
- Statuts inclus : PENDING et PAID (historique complet).

---

### 4.9 Dashboard Analytique

**Description :** Interface de pilotage présentant les indicateurs clés du portefeuille selon le rôle de l'utilisateur. Un Owner voit son portefeuille. Un Manager voit les biens délégués. Un Admin voit la plateforme entière. Réalise UJ-2.

**Functional Requirements :**

#### FR-32 : KPIs de portefeuille

Un Owner ou Manager peut consulter en temps réel :
- Nombre de biens par statut (AVAILABLE, RENTED, MAINTENANCE, RESERVED).
- Taux d'occupation = `RENTED / total biens`.
- Revenus locatifs du mois courant (somme des Payments PAID).
- Paiements en retard (nombre + montant total LATE).
- Contrats expirant dans 30 jours.

**Consequences :**
- Données calculées à la volée via requêtes agrégées Prisma.
- [ASSUMPTION] : Cache Redis (TTL 5 min) pour les métriques agrégées lourdes.

#### FR-33 : KPIs de maintenances

Un Owner ou Manager peut voir :
- Nombre de demandes ouvertes par urgence.
- Délai moyen de résolution (OPEN → RESOLVED) sur les 30 derniers jours.

#### FR-34 : KPIs de commissions (Agence)

Un Manager peut voir :
- Commissions encaissées du mois.
- Commissions en attente.
- Top 5 des propriétaires par volume de commission.

#### FR-35 : KPIs Admin plateforme

Un Admin peut consulter :
- Nombre total d'utilisateurs actifs par rôle.
- Nombre de biens, contrats actifs, paiements LATE sur la plateforme.
- Revenu mensuel de la plateforme (commissions + services).
- Agences les plus actives.

#### FR-45 : Dashboard Tenant

Un Tenant peut consulter un tableau de bord synthétique centré sur sa situation locative.

**Endpoint :** `GET /dashboard/tenant`

**Consequences :**
- Affiche : résumé du contrat actif (bien, loyer, dates), prochain paiement dû (montant + date), 3 derniers paiements (statut + montant), compteurs de demandes de maintenance (OPEN, IN_PROGRESS, RESOLVED).
- Si le Tenant n'a pas de contrat actif, retourne un état vide sans erreur.
- Données calculées à la volée — pas de cache (volume faible, données personnelles).

---

## 5. Non-Goals (Explicit)

- **Vente immobilière :** La plateforme gère uniquement la location. Aucune transaction d'achat/vente n'est dans le scope.
- **Locations courte durée (Airbnb-style) :** Les contrats sont mensuels à annuels. Pas de réservation nuit par nuit.
- **Intégration bancaire directe :** Pas de débit automatique / prélèvement SEPA. Le paiement est enregistré manuellement.
- **Signature électronique légale :** Les PDF sont générés mais ne sont pas certifiés avec une signature électronique qualifiée (v2).
- **Application mobile native :** Le MVP cible le web responsive. Les apps iOS/Android sont v2.
- **Multi-devise :** Uniquement FCFA (XAF) pour le MVP.
- **Marché hors Cameroun :** L'interface, la devise et les règles fiscales sont calées sur le Cameroun. L'expansion CEMAC est v2.
- **Marketplace publique de location :** La plateforme n'est pas un portail d'annonces grand public (type Jumia House). Le portail public est un complément, pas le cœur.
- **SMS :** Les notifications par SMS (MTN CM, Orange CM, Twilio) sont différées en v2. Le MVP utilise uniquement l'email comme canal de notification externe.
- **KYC / validation RCCM :** La vérification du numéro RCCM des agences n'est pas obligatoire en MVP. L'activation est immédiate. Une procédure de vérification manuelle par l'Admin est possible mais non imposée.
- **Scoring de solvabilité des candidats :** Les Candidatures (FR-36) sont traitées manuellement par le gestionnaire. Aucun scoring automatique ni vérification documentaire en MVP.
- **Archivage long terme (10 ans) :** La rétention légale de 10 ans est documentée. Le mécanisme d'archivage automatique est différé en v2 — en MVP, les données sont conservées en base sans politique d'archivage active.

---

## 6. Non-Functional Requirements

### 6.1 Performance

| Métrique | Cible | Contexte |
|----------|-------|---------|
| Latence API (p95) | < 300 ms | Endpoints lecture (GET) |
| Latence API (p95) | < 800 ms | Endpoints écriture (POST/PATCH) |
| Latence API (p95) | < 3 s | Génération PDF synchrone (contrats, quittances, reçus commission) |
| Throughput | 200 req/60s/IP | ThrottlerGuard configuré |
| Disponibilité | 99,5 % / mois | SLA cible MVP |

### 6.2 Sécurité

- Tous les endpoints sont protégés par JWT (`JwtAuthGuard` global). Les routes publiques utilisent `@Public()`.
- Les mots de passe sont hachés avec `bcrypt` (salt = 12). Jamais stockés en clair.
- Les refresh tokens sont révoqués à chaque rotation. Révocation totale possible (logout).
- Les uploads de fichiers sont validés en type MIME + taille avant envoi sur R2.
- CORS restreint aux origines `immoplus.cm`, `www.immoplus.cm`, `localhost:5173`, `localhost:3001`.
- Rate limiting global : 200 requêtes / 60 secondes par IP.
- Les données sensibles (clés API, secrets JWT) sont injectées via variables d'environnement (jamais en dur).

### 6.3 Qualité de code

- Validation stricte des DTOs (`class-validator`, `whitelist: true`, `forbidNonWhitelisted: true`).
- Toutes les réponses sont enveloppées dans `{ data, statusCode, timestamp }` via `TransformInterceptor`.
- Les erreurs retournent `{ statusCode, error, message, details?, path, timestamp }` via `GlobalExceptionFilter`.
- Les opérations multi-tables sont atomiques via `UnitOfWorkService` (Prisma `$transaction`).

### 6.4 Scalabilité

- Architecture stateless : le backend peut être scalé horizontalement derrière un load balancer.
- Le cache Redis est partagé entre instances.
- Les tâches lourdes (envoi d'emails en volume) sont déléguées à BullMQ (workers découplés). La génération PDF est synchrone en MVP.

### 6.5 Observabilité

- `LoggingInterceptor` : toutes les requêtes HTTP sont loggées (méthode, path, durée, statut).
- `Logger` NestJS utilisé dans tous les services et cron jobs.
- Cron jobs loggent le nombre d'entités traitées après chaque exécution.

### 6.6 Internationalisation

- Messages d'erreur et notifications en **français** (marché camerounais).
- Format monétaire : `toLocaleString('fr-FR')` + ` FCFA`.
- Format de date : `date-fns` avec locale `fr`.

---

## 7. MVP Scope & Roadmap

### Phase 1 — Core (M0 → M2) ✅ Complet

| Module | Statut |
|--------|--------|
| Authentification (JWT, OTP, refresh, reset) | ✅ Implémenté |
| Gestion des utilisateurs — profil + admin (FR-1–FR-4, FR-39–FR-40) | ✅ Implémenté |
| Gestion des propriétés (CRUD, images, documents, publication) | ✅ Implémenté |
| Candidatures publiques — soumission + traitement back-office (FR-36) | ✅ Implémenté |
| Gestion des locataires (CRUD, dossier) | ✅ Implémenté |
| Gestion des contrats (création, renouvellement, résiliation, PDF synchrone) | ✅ Implémenté |
| Gestion des paiements (enregistrement, cron retards, quittance PDF, téléchargement Tenant) | ✅ Implémenté |
| Alertes de paiement configurables + alertes expiration de bail | ✅ Implémenté |
| Maintenances (CRUD, transitions de statut, upload photos R2) | ✅ Implémenté |
| Notifications in-app + file BullMQ email | ✅ Implémenté |
| Infrastructure (PrismaPg, Redis CacheService, PdfService, ThrottlerGuard, CORS) | ✅ Implémenté |

### Phase 2 — Agences & Commissions (M2 → M4) ✅ Complet

| Module | Statut |
|--------|--------|
| Gestion des agences (création, membres, profil public, suspension) | ✅ Implémenté |
| Mandats de gestion non exclusifs M:N — création, résiliation, expiration cron (FR-27, FR-37) | ✅ Implémenté |
| MandateGuard — contrôle d'accès Manager sur les biens mandatés | ✅ Implémenté |
| Commissions auto MANAGEMENT sur encaissement + manuelles + annulation (FR-38, FR-29, FR-43) | ✅ Implémenté |
| Vue commissions dues Owner par agence (FR-44) | ✅ Implémenté |
| PDF reçu commission synchrone | ✅ Implémenté |
| Migrations Prisma Phase 2 — entités `Agency`, `AgencyMember`, `Mandate`, `Commission` | ✅ Implémenté |

### Phase 3 — Analytics & Automatisation (M4 → M6) ✅ Partiellement complet

| Module | Statut |
|--------|--------|
| Dashboard Owner / Manager — KPIs portefeuille, maintenances, commissions (FR-32–FR-34) | ✅ Implémenté |
| Dashboard Admin — KPIs plateforme (FR-35) | ✅ Implémenté |
| Dashboard Tenant — contrat actif, prochain paiement, historique, maintenances (FR-45) | ✅ Implémenté |
| Rapports exportables (CSV commissions, paiements) | ❌ À créer — confirmé Phase 3 |

### Phase 4 — Marketplace & Mobile (M6+) 🔮 Vision

| Module | Statut |
|--------|--------|
| Portail annonces public amélioré | ❌ v2 |
| Application mobile React Native | ❌ v2 |
| Signature électronique des contrats | ❌ v2 |
| Intégration Mobile Money (API MTN / Orange) | ❌ v2 |
| SMS notifications (MTN CM, Orange CM) | ❌ v2 |
| Expansion marché CEMAC | ❌ v3 |

---

## 8. Success Metrics

**Primary**

- **SM-1 :** Taux de paiement à l'heure — `PAID / (PAID + LATE)` par mois. Cible : > 92 %. Valide FR-18, FR-19.
- **SM-2 :** Taux d'adoption des agences — ≥ 30 agences avec contrat actif à M+12. Valide FR-25, FR-26, FR-27.
- **SM-3 :** Délai de mise en location — médiane < 21 jours (AVAILABLE → RENTED). Valide FR-5, FR-6, FR-13.

**Secondary**

- **SM-4 :** NPS locataires — score ≥ 35 à M+6 (enquête in-app). Valide UJ-3.
- **SM-5 :** Taux de résolution maintenance CRITICAL < 48 h. Valide FR-22, FR-23.
- **SM-6 :** Taux de génération de quittance — 100 % des PAID ont un PDF. Valide FR-18.

**Counter-metrics (ne pas optimiser)**

- **SM-C1 :** Latence API — ne pas dépasser 300 ms (p95 GET) en cherchant à pré-calculer tous les KPIs. Préférer le cache Redis ciblé.
- **SM-C2 :** Nombre de notifications envoyées — ne pas sur-notifier (risque de désabonnement). Max 3 notifications/mois/locataire pour les relances.

---

## 9. Contraintes & Guardrails

### 9.1 Technique

- **Schéma Prisma :** toutes les nouvelles entités (`Agency`, `AgencyMember`, `Mandate`, `Commission`) doivent suivre la convention `@@map("snake_case")` et utiliser UUID `@default(uuid())` comme PK.
- **Transactions atomiques :** toute opération multi-table passe par `UnitOfWorkService.execute()`. L'enregistrement d'un paiement PAID (FR-18) génère la quittance PDF + la commission MANAGEMENT dans une seule transaction.
- **Pagination :** les endpoints liste utilisent `SearchRequest` (0-based `pageNumber`). Les interfaces HTTP client utilisent 1-based (`page`) — la conversion est faite dans le service.
- **Soft-delete :** les entités sensibles (Property, Mandate) utilisent `deletedAt` — jamais de hard-delete direct.
- **Images :** max 4 par Property. La couverture est auto-assignée à l'upload si aucune n'existe.
- **Mandats non exclusifs :** la logique d'autorisation du Manager doit vérifier l'existence d'un `Mandate` ACTIVE (non `Property.managerId`) pour accorder les droits de gestion.
- **Commissions :** les montants sont stockés en entiers (FCFA, sans décimales). La TVA est calculée au moment de la création et stockée dans des champs séparés (`amountHT`, `tvaAmount`, `amountTTC`).

### 9.2 Réglementaire (Cameroun)

- TVA applicable : 19,25 % (configurable dans `AdminSettings.vatRate`).
- Les quittances et reçus de commission sont des documents légaux — format PDF avec mentions obligatoires (bailleur/agence, locataire/propriétaire, adresse, période, montant HT, TVA, TTC).
- La conservation des données contractuelles est obligatoire pendant **10 ans** (confirmé — droit camerounais). Le mécanisme d'archivage automatique est différé en v2.

---

## 10. Open Questions — Toutes résolues ✅

Toutes les questions ont été clarifiées le 2026-06-12 avec Idris Feudjio. Voir `.decision-log.md` pour le détail complet.

| # | Question | Décision |
|---|----------|----------|
| OQ-1 | Relation Agence / Owner — exclusif ou non ? | ✅ **Option B — mandats non exclusifs (M:N).** Un bien peut être sous plusieurs Mandats simultanément. Entité `Mandate` créée. |
| OQ-2 | Commission MANAGEMENT — auto ou manuelle ? | ✅ **Auto sur encaissement + ajustements manuels possibles.** Le Mandat porte le taux/montant fixe. Commission MANAGEMENT générée automatiquement dans la transaction `registerPayment()`. Commissions manuelles pour les frais exceptionnels. |
| OQ-3 | SMS requis en MVP ? | ✅ **Email uniquement.** SMS différé en v2. |
| OQ-4 | PDF — synchrone ou asynchrone ? | ✅ **Synchrone (< 3 s).** Génération dans la requête HTTP. Pas de BullMQ pour PDF en MVP. |
| OQ-5 | KYC RCCM obligatoire ? | ✅ **Non obligatoire.** RCCM = champ optionnel. Activation immédiate. KYC formel = v2. |
| OQ-6 | Candidature publique dans le MVP ? | ✅ **Oui — version simplifiée.** Formulaire public → `Application` PENDING → traitement back-office. Scoring / docs = v2. |
| OQ-7 | Exports CSV/PDF — Phase 3 ou v2 ? | ✅ **Phase 3** (M4–M6) comme prévu. |
| OQ-8 | Conservation légale = 10 ans ? | ✅ **Confirmé.** Mécanisme d'archivage automatique différé en v2. |

---

## 11. Assumptions Index

- **A-1 (§4.2 FR-6) :** Le message d'erreur de publication sans image est `"Le bien doit avoir au moins 1 image pour être publié."` — wording UX à confirmer avec le designer.
- ~~**A-2** : PDF asynchrone via BullMQ~~ → **CLOS** (OQ-4 résolu : PDF synchrone, voir FR-17).
- ~~**A-3 (§4.7) :** Entités `Agency`, `AgencyMember`, `Mandate` à créer~~ → **CLOS** (migrations Phase 2 livrées — story 0-7, 2026-06-13).
- ~~**A-4 (§4.8) :** Entité `Commission` à créer avec `amountHT`, `tvaAmount`, `amountTTC`~~ → **CLOS** (migrations Phase 2 livrées — story 0-7, 2026-06-13).
- ~~**A-5 (§4.9 FR-32) :** Cache Redis (TTL 5 min) pour les métriques dashboard~~ → **CLOS** (CacheService implémenté — story 0-6 ; TTL 5 min confirmé sur les endpoints dashboard).
- ~~**A-6 (§4.5 FR-18) :** Génération de quittance synchrone dans `registerPayment()` — stratégie de retry à définir~~ → **CLOS** (PDF synchrone confirmé ; en cas d'échec R2 la transaction PAID reste commitée — comportement accepté pour le MVP).
- **A-7 (§9.2) :** La TVA de 19,25 % s'applique aux commissions d'agence. À confirmer avec un comptable camerounais si les honoraires d'agence relèvent d'un régime TVA différent.
- **A-8 (§4.7 FR-27) :** En cas de mandats non exclusifs multiples sur un même bien, la notification de commission pour l'Owner groupe les commissions de tous les Mandats actifs dans un seul email (à confirmer lors de la conception UX).
