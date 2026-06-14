---
baseline_commit: 0a1607a
---

# Story 10.3: Email Address Normalization to Lowercase

Status: review

## Story

As a **registered user**,
I want my email address stored in lowercase regardless of how I typed it,
So that I can always log in without caring about capitalization.

## Acceptance Criteria

1. A registration request with email `"Owner@ImmoPlusCM.com"` results in a persisted user email of `"owner@immopluscm.com"`.
2. A login request with email `"OWNER@IMMOPLUSCM.COM"` and the correct password succeeds by normalizing to `"owner@immopluscm.com"` before the database lookup.
3. `forgotPassword()` normalizes the email parameter before the database lookup (consistent behavior, prevents "no account found" false negatives).
4. A Prisma data migration normalizes all existing user emails to lowercase (idempotent: only updates rows where `email != LOWER(email)`).
5. All existing tests continue to pass (0 regressions).

## Tasks / Subtasks

- [x] Task 1 — Normalize email in `register()` (AC: 1)
  - [x] Add `const email = dto.email.toLowerCase();` at the top of `register()`, before any DB operation
  - [x] Replace all `dto.email` usages in `register()` with the local `email` variable
  - [x] File: `src/auth/auth.service.ts`

- [x] Task 2 — Normalize email in `login()` (AC: 2)
  - [x] Add `const email = dto.email.toLowerCase();` at the top of `login()`, before the DB lookup
  - [x] Replace `email: dto.email` in the `findUnique` call with `email: email`
  - [x] File: `src/auth/auth.service.ts`

- [x] Task 3 — Normalize email in `forgotPassword()` (AC: 3)
  - [x] Add `const normalizedEmail = email.toLowerCase();` at the top of `forgotPassword()`
  - [x] Replace the `findUnique` call's `{ email }` with `{ email: normalizedEmail }`
  - [x] File: `src/auth/auth.service.ts`

- [x] Task 4 — Create Prisma data migration (AC: 4)
  - [x] Run `npx prisma migrate dev --name lowercase_user_emails --create-only`
  - [x] Edit the generated migration SQL to add: `UPDATE "users" SET email = LOWER(email) WHERE email != LOWER(email);`
  - [x] Run `npx prisma migrate dev` → migration `20260614133124_lowercase_user_emails` applied successfully

- [x] Task 5 — Validate (AC: 5)
  - [x] Run `npx tsc --noEmit` → 0 errors
  - [x] Run `npx jest --passWithNoTests` → 221/221 tests passed, 0 regressions

## Dev Notes

### Context

This story fixes **Audit finding H5** — email addresses were stored as-is (mixed case possible), causing silent login failures when users capitalized their email differently at registration vs. login.

**Scope:** 1 service file + 1 Prisma migration SQL. No schema changes (column type and unique index unchanged). No new dependencies.

---

### File: `src/auth/auth.service.ts` — Current State

**`register()` — lines 28-81:**
```typescript
async register(dto: RegisterDto) {
  if (dto.password !== dto.passwordConfirm) {
    throw new BadRequestException('Les mots de passe ne correspondent pas.');
  }

  const existingEmail = await this.prisma.user.findUnique({ where: { email: dto.email } });
  if (existingEmail) {
    throw new ConflictException({ error: 'EMAIL_ALREADY_EXISTS', message: 'Email déjà utilisé.' });
  }
  // ...
  const user = await this.prisma.user.create({
    data: {
      firstName: dto.firstName,
      lastName: dto.lastName,
      email: dto.email,   // ← WRONG: stores as-is
      // ...
    },
  });

  await this.emailQueue.sendEmail({
    to: user.email,       // ← OK: uses persisted value
    // ...
  });
}
```

**`login()` — lines 142-158:**
```typescript
async login(dto: LoginDto) {
  const user = await this.prisma.user.findUnique({ where: { email: dto.email } }); // ← needs toLowerCase
  // ...
}
```

**`forgotPassword()` — lines 187-209:**
```typescript
async forgotPassword(email: string) {
  const user = await this.prisma.user.findUnique({ where: { email } }); // ← needs toLowerCase
  // ...
}
```

---

### Fix 1: `register()`

```typescript
async register(dto: RegisterDto) {
  if (dto.password !== dto.passwordConfirm) {
    throw new BadRequestException('Les mots de passe ne correspondent pas.');
  }

  const email = dto.email.toLowerCase(); // ← normalize ONCE, before any DB op

  const existingEmail = await this.prisma.user.findUnique({ where: { email } });
  if (existingEmail) {
    throw new ConflictException({ error: 'EMAIL_ALREADY_EXISTS', message: 'Email déjà utilisé.' });
  }

  if (dto.phone) {
    const existingPhone = await this.prisma.user.findUnique({ where: { phone: dto.phone } });
    if (existingPhone) {
      throw new ConflictException('Numéro de téléphone déjà utilisé.');
    }
  }

  const passwordHash = await bcrypt.hash(dto.password, 12);

  const allowedRoles = ['OWNER', 'TENANT'] as const;
  if (!allowedRoles.includes(dto.role as typeof allowedRoles[number])) {
    throw new BadRequestException('Rôle non autorisé à l\'inscription.');
  }

  const user = await this.prisma.user.create({
    data: {
      firstName: dto.firstName,
      lastName: dto.lastName,
      email,               // ← uses normalized value
      phone: dto.phone,
      passwordHash,
      role: dto.role,
    },
  });

  // ... (OTP creation and emailQueue.sendEmail remain unchanged)
}
```

**Key:** define `const email = dto.email.toLowerCase()` BEFORE any DB operation and use it everywhere in the method body instead of `dto.email`. `emailQueue.sendEmail({ to: user.email })` already uses the persisted value — no change needed there.

---

### Fix 2: `login()`

```typescript
async login(dto: LoginDto) {
  const email = dto.email.toLowerCase(); // ← normalize before lookup
  const user = await this.prisma.user.findUnique({ where: { email } });

  if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
    throw new UnauthorizedException('Email ou mot de passe incorrect.');
  }
  // ... rest unchanged
}
```

---

### Fix 3: `forgotPassword()`

```typescript
async forgotPassword(email: string) {
  const normalizedEmail = email.toLowerCase(); // ← normalize before lookup
  const user = await this.prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (!user) {
    return { message: 'Si un compte avec cet email existe, un lien de réinitialisation a été envoyé.' };
  }
  // ... token creation and emailQueue.sendEmail remain unchanged
  // emailQueue.sendEmail uses user.email (already persisted lowercase after this story)
}
```

---

### Task 4: Prisma Migration

```bash
# Step 1: Generate migration skeleton (--create-only: does NOT apply)
npx prisma migrate dev --name lowercase_user_emails --create-only
```

This creates `prisma/migrations/TIMESTAMP_lowercase_user_emails/migration.sql`.

**Edit the generated SQL to add at the top:**
```sql
-- Normalize existing user emails to lowercase (idempotent)
UPDATE "users" SET email = LOWER(email) WHERE email != LOWER(email);
```

The migration file will be **empty** by default (no schema change) — the UPDATE statement is a data migration only.

```bash
# Step 2: Apply migration
npx prisma migrate dev
```

**Important:** The `email` column already has a `UNIQUE` constraint. The `UPDATE` cannot violate it because it only converts to lowercase, and no two existing users should have the same email differing only in case (the DB has enforced this at insert time — but if there are duplicates, the UPDATE will fail). In that case, dedup first (out of scope for this story since the data is clean in dev/staging).

**Do NOT run `prisma db push`** — only `prisma migrate dev` maintains the migration history.

---

### What Must Be Preserved

- `generateAuthResponse()` — uses `user.email` (persisted value) → unchanged, no normalization needed
- `emailQueue.sendEmail({ to: user.email })` — uses persisted email → unchanged
- `verifyEmail()`, `resendOtp()`, `resetPassword()`, `changePassword()` — don't look up users by email → unchanged
- The `RegisterDto`, `LoginDto`, `ForgotPasswordDto` shapes — **do NOT modify DTOs** (normalization is a service concern)

---

### Anti-Patterns to Avoid

```typescript
// ❌ NEVER — mutate the DTO directly (DTOs can be shared/reused)
dto.email = dto.email.toLowerCase();

// ❌ NEVER — normalize inside the findUnique (hard to read, easy to miss)
const user = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } });
// ...
await this.prisma.user.create({ data: { email: dto.email } }); // ← bug: forgot to normalize here

// ✅ CORRECT — normalize once, use everywhere in the method
const email = dto.email.toLowerCase();
await this.prisma.user.findUnique({ where: { email } });
await this.prisma.user.create({ data: { ..., email } });
```

```typescript
// ❌ NEVER — change DTO validators to enforce lowercase (wrong layer)
@Transform(({ value }) => value.toLowerCase())
email: string; // DO NOT add this to DTOs
```

---

### Previous Story Learnings (from 10.1 and 10.2)

- TypeScript `module: nodenext`: relative imports require `.js` extension — not relevant here (no new imports)
- No new imports needed: `.toLowerCase()` is native JavaScript
- Do NOT add debug `console.log` under any circumstances
- Existing tests (221 passing) must continue to pass — no test changes needed unless tests assert on stored email case

---

### Migration Directory Structure

```
prisma/
  migrations/
    20260527223347_1779921217/
    20260613112112_add_agency_with_enums/
    20260613151933_add_application_contact_fields/
    YYYYMMDDHHMMSS_lowercase_user_emails/   ← NEW (auto-generated timestamp)
      migration.sql
```

## Dev Agent Record

### Completion Notes

- 3 normalisations `toLowerCase()` ajoutées dans `auth.service.ts` : `register()`, `login()`, `forgotPassword()`.
- Pattern cohérent : `const email = dto.email.toLowerCase()` / `const normalizedEmail = email.toLowerCase()` défini une seule fois avant tout accès DB.
- Aucune modification des DTOs (RegisterDto, LoginDto, ForgotPasswordDto) — normalisation au niveau service uniquement.
- Migration Prisma `20260614133124_lowercase_user_emails` créée et appliquée — `UPDATE "users" SET email = LOWER(email) WHERE email != LOWER(email)` idempotente.
- `tsc --noEmit` → 0 erreur. Jest → **221/221 tests passés, 0 régression**.

## Change Log

| Date | Type | Description |
|------|------|-------------|
| 2026-06-14 | fix | Normalisation email en minuscules dans register(), login(), forgotPassword() de auth.service.ts |
| 2026-06-14 | fix | Migration Prisma 20260614133124_lowercase_user_emails — UPDATE emails existants en LOWER(email) |

## File List

- `src/auth/auth.service.ts` — MODIFY (normalize email in register, login, forgotPassword)
- `prisma/migrations/20260614133124_lowercase_user_emails/migration.sql` — NEW (data migration UPDATE statement)
