---
project_name: 'immo-plus-backend'
user_name: 'Idris Feudjio'
date: '2026-06-12'
sections_completed: [tech-stack, database, auth, api, storage, queue, domain-rules, testing, naming, error-handling, events, security]
existing_patterns_found: 24
---

# Project Context for AI Agents

_Critical rules and patterns that AI agents must follow when implementing code in this project. Focus on unobvious details that agents might otherwise miss._

---

## 1. Technology Stack — Versions & Compatibility

| Dependency | Version | Critical note |
|-----------|---------|--------------|
| NestJS | ^11 | Inject with constructor params; no property injection in services |
| Prisma | ^7.8 | **Never use raw PrismaClient** — always use PrismaPg adapter (see §2) |
| TypeScript | `^5` | `module: nodenext`, `moduleResolution: nodenext`, `target: ES2023` |
| `uuid` | v14 | `import { v4 as uuidv4 } from 'uuid'` — pas de named import `uuid()` |
| `date-fns` | ^4 | Utiliser pour toutes les opérations de dates. Pas de `dayjs`, pas de `moment`. |
| BullMQ | v5 + `@nestjs/bullmq` | Pour les emails async uniquement (MVP). PDF = synchrone. |
| ioredis | ^5.11.0 | Client Redis. Ne pas utiliser `redis` npm package. |
| `@aws-sdk/client-s3` | v3 | Pour Cloudflare R2. Region = `"auto"`. |
| bcrypt | — | `saltRounds = 12`. Jamais < 12. |

### TypeScript : imports critiques

```typescript
// ✅ Correct — nodenext exige l'extension .js (même pour .ts sources)
import { BaseRepository } from '../common/abstractions/base.repository.js';

// ✅ Correct — import nommé uuid
import { v4 as uuidv4 } from 'uuid';

// ❌ Interdit
import { PrismaClient } from '@prisma/client';
```

---

## 2. Prisma — PrismaPg Adapter (RÈGLE ABSOLUE)

**CRITICAL : Ne jamais instancier `PrismaClient` directement.**

```typescript
// ✅ Correct — toujours utiliser PrismaService qui utilise PrismaPg
// src/prisma/prisma.service.ts
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
this.prisma = new PrismaClient({ adapter });

// ✅ Dans tout autre service — injecter PrismaService
constructor(private prisma: PrismaService) {}

// ❌ Interdit partout ailleurs
const client = new PrismaClient();
```

### Prisma : select toujours explicite sur User

```typescript
// ✅ Correct — passwordHash JAMAIS exposé
const user = await this.prisma.user.findUnique({
  where: { id },
  select: { id: true, email: true, role: true, /* ... */ },  // passwordHash absent
});

// ❌ Interdit
const user = await this.prisma.user.findUnique({ where: { id } });
```

---

## 3. BaseRepository — Pattern obligatoire

Tout repository hérite de `BaseRepository<PrismaModel, DomainDto>` de `src/common/abstractions/base.repository.ts`.

```typescript
// Structure type d'un repository
@Injectable()
export class PropertyRepository extends BaseRepository<
  Prisma.PropertyDelegate,
  Property
> {
  constructor(prisma: PrismaService) {
    super(prisma.property, PROPERTY_QUERY_FIELDS);
  }
}

// QueryField — pour champs searchables
const PROPERTY_QUERY_FIELDS: QueryField[] = [
  { field: 'title',   filterType: FilterType.STRING },
  { field: 'city',    filterType: FilterType.STRING },
  { field: 'status',  filterType: FilterType.ENUM },
  { field: 'price',   filterType: FilterType.NUMBER },
];

// SearchRequest — 0-based pageNumber
const request: SearchRequest = {
  pageNumber: 0,   // 0 = première page
  pageSize: 20,
  searchTerm: 'Yaoundé',
  sortBy: 'createdAt',
  sortOrder: 'desc',
};
```

---

## 4. UnitOfWork — Transactions multi-tables

Pour toute opération qui touche plusieurs tables en même temps, utiliser `UnitOfWorkService.execute()`.

```typescript
// src/database/unit-of-work.service.ts
await this.unitOfWork.execute(async (prisma) => {
  const contract = await prisma.contract.create({ data: { ... } });
  await prisma.property.update({ where: { id: propertyId }, data: { status: 'RENTED' } });
  await prisma.payment.createMany({ data: payments });
  return contract;
});

// ❌ Interdit — appels séparés sans transaction
await this.contractRepo.create(data);
await this.propertyRepo.update(id, { status: 'RENTED' }); // race condition possible
```

---

## 5. Réponses API — Envelopes obligatoires

### Succès — TransformInterceptor (global, automatique)

```json
{
  "data": { ... },
  "statusCode": 200,
  "timestamp": "2026-06-12T10:00:00.000Z"
}
```

**Ne pas wrapper manuellement la réponse.** Le `TransformInterceptor` le fait automatiquement. Retourner le plain object depuis le controller.

### Erreur — GlobalExceptionFilter (global, automatique)

```json
{
  "statusCode": 400,
  "error": "Bad Request",
  "message": "Validation failed",
  "details": ["price must be a positive number"],
  "path": "/api/properties",
  "timestamp": "2026-06-12T10:00:00.000Z"
}
```

**Ne pas construire manuellement les réponses d'erreur.** Lancer des exceptions NestJS standard (`BadRequestException`, `NotFoundException`, `ForbiddenException`).

---

## 6. Auth — Guards & Décorateurs

```typescript
// Route publique (opt-out du JwtAuthGuard global)
@Public()
@Get('public')
findAllPublic() { ... }

// Route avec rôle requis
@Roles(Role.OWNER, Role.ADMIN)
@Post()
create() { ... }

// Route avec vérification de mandat (Manager sur un bien)
@UseGuards(MandateGuard)
@Patch(':propertyId')
update() { ... }

// Récupérer l'utilisateur courant dans le controller
@Get('me')
getProfile(@CurrentUser() user: JwtPayload) { ... }
```

### JWT Payload shape

```typescript
interface JwtPayload {
  sub: string;    // userId
  email: string;
  role: Role;
}
```

---

## 7. Règles métier critiques (Cameroun / FCFA)

```
Devise               : FCFA (XAF) — tous les montants en integers (pas de Decimal)
TVA                  : 19,25% — TOUJOURS stocker le taux en snapshot (pas recalcul dynamique)
Date d'échéance      : 5 du mois (hardcodé dans buildPaymentSchedule())
Slug Property        : `{title-slugifié}-{uuid.slice(0, 8)}`
Max images Property  : 4 images par bien, 1 cover obligatoire si images présentes
Soft-delete Property : via `deletedAt` — interdit si contrat ACTIVE existe
Refresh token        : UUID v4, durée 30 jours, rotation à chaque usage
OTP                  : 6 chiffres, expiration 15 min, max 3 tentatives/10 min
bcrypt               : saltRounds = 12 (jamais moins)
```

### Calcul TVA

```typescript
// Toujours calculer ainsi :
const amountHT = ...; // integer FCFA
const tvaRate = 19.25;
const tvaAmount = Math.round(amountHT * tvaRate / 100);
const amountTTC = amountHT + tvaAmount;
// Stocker les 3 valeurs + tvaRate (snapshot)
```

---

## 8. Domain Events — Pattern EventEmitter2

```typescript
// Émission dans un use case / handler
constructor(private eventEmitter: EventEmitter2) {}

this.eventEmitter.emit('payment.registered', new PaymentRegisteredEvent({
  paymentId, contractId, ownerId, tenantId, amount
}));

// Abonnement dans un event handler
@Injectable()
export class AutoGenerateCommissionHandler {
  @OnEvent('payment.registered')
  async handle(event: PaymentRegisteredEvent) { ... }
}

// Règle : les event handlers ne doivent JAMAIS émettre d'autres events
// (évite les chaînes circulaires difficiles à debugger)
```

---

## 9. Pagination — Conventions

```typescript
// DTO client (0-based pageNumber)
class PaginationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  pageNumber?: number = 0;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;
}

// PaginatedResult<T> retourné par tous les endpoints de liste
interface PaginatedResult<T> {
  items: T[];
  total: number;
  pageNumber: number;
  pageSize: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}
```

---

## 10. Stockage R2 (Cloudflare)

```typescript
// StorageService — méthodes disponibles
await this.storage.uploadBuffer(key, buffer, contentType);    // returns URL
await this.storage.delete(key);
await this.storage.getSignedUrl(key, expiresIn);

// Convention de clés R2 :
`properties/{propertyId}/images/{imageId}.{ext}`
`receipts/{contractId}/{paymentId}.pdf`
`contracts/{contractId}/contract.pdf`
`commissions/{commissionId}/receipt.pdf`

// Region toujours "auto" pour Cloudflare R2
// Bucket via env: CLOUDFLARE_R2_BUCKET
```

---

## 11. Nomenclature — Conventions de nommage

```
Modules          : PascalCase, suffixe Module     (PropertyModule, AgencyModule)
Services         : PascalCase, suffixe Service     (PropertyService, AgencyService)
Repositories     : PascalCase, suffixe Repository  (PropertyRepository)
Controllers      : PascalCase, suffixe Controller  (PropertyController)
DTOs             : PascalCase, suffixe Dto         (CreatePropertyDto)
View Models      : PascalCase, suffixe Vm          (PropertyDetailVm)
Domain Events    : PascalCase, suffixe Event       (PaymentRegisteredEvent)
Commands         : PascalCase, suffixe Command     (RegisterPaymentCommand)
Queries          : PascalCase, suffixe Query       (GetDashboardMetricsQuery)
Guards           : PascalCase, suffixe Guard       (MandateGuard)
Interceptors     : PascalCase, suffixe Interceptor (TransformInterceptor)
Enums            : SCREAMING_SNAKE_CASE values     (Role.AGENCY_ADMIN)
Prisma tables    : snake_case via @@map            (@@map("agency_members"))
Colonnes Prisma  : camelCase dans schema, snake via @map si besoin
Événements       : dot.notation lowercase          ('payment.registered')
Clés Redis       : colon:notation                  ('dashboard:{userId}:metrics')
```

---

## 12. Gestion d'erreurs — Pattern standard

```typescript
// ✅ Correct — exception NestJS avec message descriptif
throw new NotFoundException(`Property ${id} not found`);
throw new ConflictException('An active contract already exists for this property');
throw new ForbiddenException('Insufficient permissions on this property');

// ❌ Interdit — throw Error brut (ignoré par GlobalExceptionFilter)
throw new Error('not found');

// Ownership check pattern dans le service (pas le controller)
const property = await this.repo.findByIdOrThrow(id);
if (property.ownerId !== currentUser.id && !hasMandatedAccess) {
  throw new ForbiddenException('Insufficient permissions on this property');
}
```

---

## 13. Nouveau module — Checklist de création

Quand tu crées un nouveau module (`AgencyModule`, `MandateModule`, `CommissionModule`…) :

1. **Repository** — hérite de `BaseRepository`, définit `QUERY_FIELDS`, injecte `PrismaService`
2. **Service** — hérite de `BaseService`, injecte le repository via interface
3. **Controller** — hérite de `BaseController`, décore avec `@ApiTags` et `@ApiBearerAuth`
4. **Module** — exporte le Service et le Repository pour injection dans d'autres modules
5. **DTOs** — dans `src/{module}/dtos/`, class-validator sur tous les champs
6. **Enregistrement** — ajouter dans `AppModule.imports[]`
7. **Swagger** — `@ApiProperty` sur tous les champs DTO, `@ApiResponse` sur tous les endpoints

---

## 14. Anti-patterns — Ne jamais faire

```typescript
// ❌ Logique métier dans un controller
@Post()
async create(@Body() dto) {
  if (dto.price < 0) throw ...; // cette logique va dans le service
}

// ❌ Accès Prisma direct depuis un controller ou service applicatif
// (uniquement via repository)

// ❌ passwordHash dans la réponse
select: { id: true, email: true, passwordHash: true } // ← JAMAIS

// ❌ Dates relatives (invariantes dans le temps)
// "créé il y a 3 jours" → utiliser date-fns format avec date absolue

// ❌ Montants FCFA en Decimal / float
const price = 150000.50; // ← utiliser integer : 150000

// ❌ Recalculer la TVA depuis un taux dynamique
// → toujours snapshotter tvaRate + tvaAmount au moment de la création Commission

// ❌ Émettre des events depuis un event handler
@OnEvent('payment.registered')
async handle(event) {
  // ...
  this.eventEmitter.emit('commission.generated', ...); // ← INTERDIT
}
```
