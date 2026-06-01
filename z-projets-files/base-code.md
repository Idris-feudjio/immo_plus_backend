Tu es un expert NestJS. Je construis le backend d'une application de gestion immobilière. 
Génère une architecture complète, production-ready, avec les contraintes suivantes.

## Stack
- NestJS (dernière version stable)
- Prisma (PostgreSQL)
- Redis (cache + BullMQ pour les queues)
- class-validator / class-transformer
- Passport.js + JWT (access token + refresh token)
- Jest pour les tests

## Structure de dossiers à générer

src/
├── common/
│   ├── abstractions/
│   │   ├── base.repository.ts       # BaseRepository<T> générique avec findById, findAll, create, update, delete, findWithPagination
│   │   └── base.service.ts          # BaseService<T> optionnel
│   ├── decorators/
│   │   ├── cacheable.decorator.ts   # @Cacheable(ttl, keyPrefix)
│   │   └── cache-evict.decorator.ts # @CacheEvict(keyPrefix)
│   ├── filters/
│   │   └── http-exception.filter.ts
│   ├── interceptors/
│   │   ├── logging.interceptor.ts
│   │   ├── transform.interceptor.ts # Wraps response in { data, statusCode, timestamp }
│   │   └── cache.interceptor.ts
│   ├── guards/
│   │   ├── jwt-auth.guard.ts
│   │   └── roles.guard.ts
│   ├── pipes/
│   │   └── validation.pipe.ts
│   ├── interfaces/
│   │   ├── paginated-result.interface.ts
│   │   └── repository.interface.ts
│   └── utils/
│       └── pagination.util.ts
│
├── config/
│   ├── app.config.ts
│   ├── database.config.ts
│   └── redis.config.ts
│
├── database/
│   ├── prisma.service.ts            # PrismaService avec hooks onModuleInit/onModuleDestroy
│   └── unit-of-work.service.ts     # UnitOfWork pour les transactions Prisma
│
├── cache/
│   ├── cache.module.ts
│   └── cache.service.ts            # Wrapper Redis avec get/set/del/flush par prefix
│
├── modules/
│   ├── auth/
│   ├── users/
│   ├── properties/                  # Biens immobiliers
│   ├── tenants/                     # Locataires
│   ├── leases/                      # Contrats de bail
│   ├── payments/                    # Loyers et charges
│   ├── maintenance/                 # Demandes d'intervention
│   └── notifications/               # Email/SMS/Push via queue BullMQ
│
└── events/
    ├── property-created.event.ts
    ├── lease-signed.event.ts
    └── payment-received.event.ts

## Règles d'architecture strictes

1. **Repository Pattern** : Chaque module a son repository qui étend BaseRepository<T>. 
   Aucun service n'appelle PrismaService directement — uniquement via le repository du module.

2. **Interfaces de service** : Chaque service implémente une interface (IPropertyService, ILeaseService...).
   Les controllers dépendent des interfaces, pas des classes concrètes.

3. **Transactions** : Utiliser UnitOfWorkService pour toute opération qui touche plusieurs entités 
   (ex: création d'un bail = créer le lease + mettre à jour le statut du bien + créer le premier paiement).

4. **Cache Redis** :
   - @Cacheable({ ttl: 300, key: 'properties' }) sur les méthodes de lecture fréquentes
   - @CacheEvict({ key: 'properties' }) sur les méthodes de mutation
   - CacheService doit supporter le flush par préfixe (ex: invalider tout le cache 'properties:*')

5. **Events** : Utiliser @nestjs/event-emitter. Chaque action métier critique émet un événement 
   typé (PropertyCreatedEvent, LeaseSignedEvent, PaymentReceivedEvent). Les listeners 
   dans NotificationsModule réagissent à ces événements.

6. **DTOs** : Tous les DTOs utilisent class-validator. Séparer CreateXxxDto / UpdateXxxDto / 
   ResponseXxxDto. Utiliser @Exclude() et @Expose() pour filtrer les champs sensibles.

7. **Pagination** : findAll accepte toujours PaginationDto { page, limit, sortBy, sortOrder }.
   Retourne PaginatedResult<T> { data, meta: { total, page, limit, totalPages } }.

8. **Gestion d'erreurs** : Lancer des exceptions NestJS typées (NotFoundException, 
   ConflictException, etc.) depuis les services. Le HttpExceptionFilter les formate uniformément.

## Ce que tu dois générer en priorité

1. Le schema Prisma complet
2. PrismaService + UnitOfWorkService
3. BaseRepository<T> avec toutes les méthodes génériques
4. CacheService + les décorateurs @Cacheable et @CacheEvict
5. Le module Properties complet (module, controller, service, repository, DTOs, interface) 
   comme module de référence que je pourrai dupliquer pour les autres
6. Les guards JWT + Roles
7. Les interceptors Transform + Logging
8. Le HttpExceptionFilter global
9. AppModule avec la configuration globale (ValidationPipe, filters, interceptors)

## Conventions de code

- Tous les fichiers en TypeScript strict (strict: true dans tsconfig)
- Injection de dépendances par interface avec des tokens (provide: 'IPropertyService')
- Pas de `any`, utiliser des génériques
- Commentaires JSDoc sur toutes les méthodes publiques des services et repositories
- Nommage : camelCase pour les variables, PascalCase pour les classes, kebab-case pour les fichiers

Commence par le schema Prisma et PrismaService, puis construis couche par couche de bas en haut 
(repositories → services → controllers). À chaque module, génère aussi le fichier de test unitaire 
minimal pour le service (mock du repository).