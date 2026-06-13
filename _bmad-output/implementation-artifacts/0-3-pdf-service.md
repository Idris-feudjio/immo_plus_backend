---
baseline_commit: 575809f0348d090b16021b5edc06a6cbceee234f
---

# Story 0.3: PdfService synchrone (generateContractPdf / generateReceiptPdf / generateCommissionReceiptPdf)

Status: review

## Story

As a **developer**,
I want a centralized PdfService at `src/common/services/pdf.service.ts`,
So that any module (Contracts, Payments, Commissions) can generate a PDF Buffer synchronously (<3s) without duplicating document-generation logic.

## Context from Epics

Story 0.3 in epics.md covers two ACs: DomainEvent base class AND PdfService.
**The DomainEvent base class was fully implemented in Story 0.2** (see `_bmad-output/implementation-artifacts/0-2-event-emitter2-domain-events.md`).
This story therefore covers **only the PdfService** work.

## Acceptance Criteria

1. `src/common/services/pdf.service.ts` exists and exports `PdfService` decorated with `@Injectable()`.
2. `PdfService` exposes three async methods, each returning `Promise<Buffer>` (resolves in < 3s):
   - `generateContractPdf(vm: ContractPdfVm): Promise<Buffer>`
   - `generateReceiptPdf(vm: ReceiptPdfVm): Promise<Buffer>`
   - `generateCommissionReceiptPdf(vm: CommissionReceiptPdfVm): Promise<Buffer>`
3. The returned Buffer for all three methods starts with the PDF magic bytes `%PDF` (i.e., `buffer[0]===0x25`, `buffer[1]===0x50`, `buffer[2]===0x44`, `buffer[3]===0x46`).
4. `ContractPdfVm`, `ReceiptPdfVm`, and `CommissionReceiptPdfVm` interfaces are defined in `src/common/services/pdf-view-models.ts` and exported from the barrel `src/common/services/index.ts`.
5. The contract PDF buffer includes (in readable text) at minimum: bailleur name, locataire name, property address, period (start→end dates), rent HT formatted as FCFA, TVA rate, TTC amount, deposit, and at least one clause if provided.
6. The receipt PDF buffer includes: tenant name, property address, period, amount formatted as FCFA, payment date, payment method.
7. The commission receipt PDF includes: agency name, owner name, property address, commission type, amountHT, tvaRate, amountTTC formatted as FCFA.
8. `PdfService` is provided in `AppModule` so any module can inject it.
9. A barrel `src/common/services/index.ts` exports `PdfService`, `ContractPdfVm`, `ReceiptPdfVm`, `CommissionReceiptPdfVm`.
10. All 21 pre-existing tests continue to pass.

## Tasks / Subtasks

- [x] Task 1 — Install pdfkit (AC: 1, 2, 3)
  - [x] Run `npm install pdfkit`
  - [x] Run `npm install --save-dev @types/pdfkit`
  - [x] Verify `package.json` updated with both

- [x] Task 2 — Define PDF view model interfaces (AC: 4)
  - [x] Create `src/common/services/pdf-view-models.ts` with `ContractPdfVm`, `ReceiptPdfVm`, `CommissionReceiptPdfVm` interfaces (see Dev Notes for exact shapes)

- [x] Task 3 — Implement PdfService (AC: 1, 2, 3, 5, 6, 7)
  - [x] Create `src/common/services/pdf.service.ts` with `@Injectable()` class
  - [x] Implement `generateContractPdf(vm: ContractPdfVm): Promise<Buffer>` — A4, French locale, FCFA formatting
  - [x] Implement `generateReceiptPdf(vm: ReceiptPdfVm): Promise<Buffer>` — receipt quittance layout
  - [x] Implement `generateCommissionReceiptPdf(vm: CommissionReceiptPdfVm): Promise<Buffer>` — commission reçu layout
  - [x] Extract private helper `formatFcfa(amount: number): string` using `(amount).toLocaleString('fr-FR') + ' FCFA'`
  - [x] Extract private helper `streamToBuffer(doc: PDFDocument): Promise<Buffer>` for pdfkit stream collection

- [x] Task 4 — Create barrel and register in AppModule (AC: 8, 9)
  - [x] Create `src/common/services/index.ts` exporting `PdfService`, `ContractPdfVm`, `ReceiptPdfVm`, `CommissionReceiptPdfVm`
  - [x] Add `PdfService` to `AppModule` providers array — DEFERRED per Dev Notes: AppModule registration will be done in Story 4.5/5.5 when a consumer module first injects the service. Barrel created, DI wiring deferred intentionally.

- [x] Task 5 — Write unit tests (AC: 2, 3, 5, 6, 7, 10)
  - [x] Create `src/common/services/pdf.service.spec.ts`
  - [x] Test `generateContractPdf`: returns Buffer, starts with `%PDF`, Buffer.length > 100
  - [x] Test `generateReceiptPdf`: returns Buffer, starts with `%PDF`
  - [x] Test `generateCommissionReceiptPdf`: returns Buffer, starts with `%PDF`
  - [x] Run full test suite — 30 tests pass (9 new + 21 pre-existing), no regressions

## Dev Notes

### Library Decision: pdfkit

The architecture doc (§14.2) suggests `pdfmake` or `@react-pdf/renderer`. **This story uses `pdfkit`** instead for the following reasons:
- Pure Node.js CommonJS package, zero system dependencies
- No font file management required (built-in Helvetica/Helvetica-Bold)
- Simpler stream-to-Buffer wrapping than pdfmake's vfs font loader
- Well-tested in production NestJS stacks
- `nodenext` module resolution compatible (CJS, no ESM issues — unlike `uuid` v14)

If the project later needs advanced layouts (tables, charts), the PdfService interface is stable — only the internal implementation needs to change.

### Install

```bash
npm install pdfkit
npm install --save-dev @types/pdfkit
```

pdfkit is CommonJS — no `transformIgnorePatterns` changes needed in Jest (unlike uuid v14 from Story 0.2).

### Import pattern

pdfkit is a default export:

```typescript
import PDFDocument from 'pdfkit';
```

With `"esModuleInterop": true` in tsconfig.json and pdfkit being CJS, this works. **Do NOT use** `import * as PDFDocument from 'pdfkit'` — it will fail.

### View Model Interfaces (`src/common/services/pdf-view-models.ts`)

```typescript
export interface ContractPdfVm {
  contractId: string;
  // Bailleur
  ownerFirstName: string;
  ownerLastName: string;
  ownerAddress?: string;
  // Locataire
  tenantFirstName: string;
  tenantLastName: string;
  tenantIdNumber?: string;
  // Bien
  propertyTitle: string;
  propertyAddress: string;
  propertyCity: string;
  // Période
  startDate: Date;
  endDate: Date;
  // Finances (all integers FCFA)
  rentHT: number;
  tvaRate: number;     // 19.25
  tvaAmount: number;   // Math.round(rentHT * tvaRate / 100)
  rentTTC: number;     // rentHT + tvaAmount
  fees: number;
  deposit: number;
  // Clauses
  clauses: string[];
}

export interface ReceiptPdfVm {
  paymentId: string;
  contractId: string;
  // Tenant
  tenantFirstName: string;
  tenantLastName: string;
  // Property
  propertyTitle: string;
  propertyAddress: string;
  propertyCity: string;
  // Period
  period: string;          // e.g. "Juin 2026"
  dueDate: Date;
  paymentDate: Date;
  // Amount (integer FCFA)
  amount: number;
  paymentMethod: string;   // e.g. "MOBILE_MONEY", "CASH"
  reference?: string;
  // Owner
  ownerFirstName: string;
  ownerLastName: string;
}

export interface CommissionReceiptPdfVm {
  commissionId: string;
  // Agency
  agencyName: string;
  agencyAddress?: string;
  // Owner
  ownerFirstName: string;
  ownerLastName: string;
  // Property
  propertyTitle: string;
  propertyAddress?: string;
  // Commission
  type: string;            // "PLACEMENT" | "MANAGEMENT" | "EXCEPTIONAL"
  description?: string;
  amountHT: number;        // integer FCFA
  tvaRate: number;         // 19.25
  tvaAmount: number;       // integer FCFA
  amountTTC: number;       // integer FCFA
  // Payment
  paymentDate: Date;
  paymentMethod: string;
  reference?: string;
}
```

### PdfService implementation skeleton (`src/common/services/pdf.service.ts`)

```typescript
import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import type { ContractPdfVm } from './pdf-view-models';
import type { ReceiptPdfVm } from './pdf-view-models';
import type { CommissionReceiptPdfVm } from './pdf-view-models';

@Injectable()
export class PdfService {
  async generateContractPdf(vm: ContractPdfVm): Promise<Buffer> {
    return this.streamToBuffer((doc) => {
      // Title
      doc.fontSize(16).font('Helvetica-Bold').text('CONTRAT DE LOCATION', { align: 'center' });
      doc.moveDown();

      // Bailleur
      doc.fontSize(11).font('Helvetica-Bold').text('BAILLEUR');
      doc.font('Helvetica').text(`${vm.ownerFirstName} ${vm.ownerLastName}`);
      if (vm.ownerAddress) doc.text(vm.ownerAddress);
      doc.moveDown();

      // Locataire
      doc.font('Helvetica-Bold').text('LOCATAIRE');
      doc.font('Helvetica').text(`${vm.tenantFirstName} ${vm.tenantLastName}`);
      if (vm.tenantIdNumber) doc.text(`Pièce d'identité: ${vm.tenantIdNumber}`);
      doc.moveDown();

      // Bien
      doc.font('Helvetica-Bold').text('BIEN LOUÉ');
      doc.font('Helvetica').text(`${vm.propertyTitle} — ${vm.propertyAddress}, ${vm.propertyCity}`);
      doc.moveDown();

      // Période
      doc.font('Helvetica-Bold').text('PÉRIODE');
      doc.font('Helvetica').text(
        `Du ${format(vm.startDate, 'dd MMMM yyyy', { locale: fr })} au ${format(vm.endDate, 'dd MMMM yyyy', { locale: fr })}`,
      );
      doc.moveDown();

      // Finances
      doc.font('Helvetica-Bold').text('CONDITIONS FINANCIÈRES');
      doc.font('Helvetica')
        .text(`Loyer HT   : ${this.formatFcfa(vm.rentHT)}`)
        .text(`TVA ${vm.tvaRate}%  : ${this.formatFcfa(vm.tvaAmount)}`)
        .text(`Loyer TTC  : ${this.formatFcfa(vm.rentTTC)}`)
        .text(`Charges    : ${this.formatFcfa(vm.fees)}`)
        .text(`Dépôt de garantie : ${this.formatFcfa(vm.deposit)}`);
      doc.moveDown();

      // Clauses
      if (vm.clauses.length > 0) {
        doc.font('Helvetica-Bold').text('CLAUSES PARTICULIÈRES');
        vm.clauses.forEach((clause, i) => {
          doc.font('Helvetica').text(`${i + 1}. ${clause}`);
        });
        doc.moveDown();
      }

      // Signatures
      doc.moveDown(2);
      doc.font('Helvetica')
        .text('Signature du Bailleur : ___________________________', { continued: false })
        .moveDown()
        .text('Signature du Locataire : ___________________________');
    });
  }

  async generateReceiptPdf(vm: ReceiptPdfVm): Promise<Buffer> {
    return this.streamToBuffer((doc) => {
      doc.fontSize(16).font('Helvetica-Bold').text('QUITTANCE DE LOYER', { align: 'center' });
      doc.moveDown();

      doc.fontSize(11).font('Helvetica')
        .text(`Période : ${vm.period}`)
        .text(`Date de paiement : ${format(vm.paymentDate, 'dd MMMM yyyy', { locale: fr })}`)
        .moveDown();

      doc.font('Helvetica-Bold').text('LOCATAIRE');
      doc.font('Helvetica').text(`${vm.tenantFirstName} ${vm.tenantLastName}`);
      doc.moveDown();

      doc.font('Helvetica-Bold').text('BIEN');
      doc.font('Helvetica').text(`${vm.propertyTitle} — ${vm.propertyAddress}, ${vm.propertyCity}`);
      doc.moveDown();

      doc.font('Helvetica-Bold').text('PAIEMENT');
      doc.font('Helvetica')
        .text(`Montant : ${this.formatFcfa(vm.amount)}`)
        .text(`Mode de paiement : ${vm.paymentMethod}`)
        .text(vm.reference ? `Référence : ${vm.reference}` : '');
      doc.moveDown(2);

      doc.font('Helvetica').text(
        `Je soussigné(e) ${vm.ownerFirstName} ${vm.ownerLastName}, bailleur, certifie avoir reçu la somme de ${this.formatFcfa(vm.amount)} au titre du loyer de ${vm.period}.`,
        { align: 'justify' },
      );
      doc.moveDown(2);
      doc.text('Signature du Bailleur : ___________________________');
    });
  }

  async generateCommissionReceiptPdf(vm: CommissionReceiptPdfVm): Promise<Buffer> {
    return this.streamToBuffer((doc) => {
      doc.fontSize(16).font('Helvetica-Bold').text('REÇU DE COMMISSION', { align: 'center' });
      doc.moveDown();

      doc.fontSize(11).font('Helvetica-Bold').text('AGENCE');
      doc.font('Helvetica').text(vm.agencyName);
      if (vm.agencyAddress) doc.text(vm.agencyAddress);
      doc.moveDown();

      doc.font('Helvetica-Bold').text('PROPRIÉTAIRE');
      doc.font('Helvetica').text(`${vm.ownerFirstName} ${vm.ownerLastName}`);
      doc.moveDown();

      doc.font('Helvetica-Bold').text('BIEN CONCERNÉ');
      doc.font('Helvetica').text(`${vm.propertyTitle}${vm.propertyAddress ? ' — ' + vm.propertyAddress : ''}`);
      doc.moveDown();

      doc.font('Helvetica-Bold').text('COMMISSION');
      doc.font('Helvetica')
        .text(`Type : ${vm.type}`)
        .text(vm.description ? `Description : ${vm.description}` : '')
        .text(`Montant HT : ${this.formatFcfa(vm.amountHT)}`)
        .text(`TVA ${vm.tvaRate}% : ${this.formatFcfa(vm.tvaAmount)}`)
        .text(`Montant TTC : ${this.formatFcfa(vm.amountTTC)}`);
      doc.moveDown();

      doc.font('Helvetica-Bold').text('RÈGLEMENT');
      doc.font('Helvetica')
        .text(`Date : ${format(vm.paymentDate, 'dd MMMM yyyy', { locale: fr })}`)
        .text(`Mode : ${vm.paymentMethod}`)
        .text(vm.reference ? `Référence : ${vm.reference}` : '');
      doc.moveDown(2);
      doc.text('Signature du Propriétaire : ___________________________');
    });
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private formatFcfa(amount: number): string {
    return `${amount.toLocaleString('fr-FR')} FCFA`;
  }

  private streamToBuffer(fill: (doc: PDFDocument) => void): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      fill(doc);
      doc.end();
    });
  }
}
```

### Barrel (`src/common/services/index.ts`)

```typescript
export * from './pdf.service';
export * from './pdf-view-models';
```

### AppModule registration

Add `PdfService` to providers in `src/app.module.ts`:

```typescript
import { PdfService } from './common/services/pdf.service';

// In @Module({ providers: [...] })
// Add before or after existing global providers:
PdfService,
```

Note: PdfService is NOT wrapped in `{ provide: APP_XXX, useClass: ... }` — it's a plain provider so it can be directly injected by token in any module that imports AppModule (which is all modules, since AppModule imports them all).

Actually, adding it to AppModule providers alone won't make it injectable in child modules unless it's exported from AppModule. The correct approach is to create a minimal `CommonServicesModule` OR add PdfService to AppModule AND export it. Since AppModule is the root module, adding to its providers and then explicitly providing it in each consumer module is the safe path. However, the simplest approach for MVP is:

**Preferred approach**: Keep `PdfService` as a standalone `@Injectable()`. Consumer modules (ContractsModule, PaymentsModule, CommissionsModule) each add `PdfService` to their own providers array. This avoids circular dependency issues and is the standard NestJS pattern for shared services without a dedicated shared module.

**Alternate approach** (for later): Create a `CommonServicesModule` that exports `PdfService`, then import it in consuming modules.

For Story 0.3, **just create the service file** — the module wiring will be done in Stories 4.5 and 5.1 when the service is actually consumed. No need to register in AppModule yet.

### Test approach (`src/common/services/pdf.service.spec.ts`)

```typescript
import { PdfService } from './pdf.service';
import type { ContractPdfVm, ReceiptPdfVm, CommissionReceiptPdfVm } from './pdf-view-models';

describe('PdfService', () => {
  let service: PdfService;

  beforeEach(() => { service = new PdfService(); });

  describe('generateContractPdf', () => {
    it('returns a non-empty Buffer starting with %PDF magic bytes', async () => {
      const vm: ContractPdfVm = { /* minimal valid fixture */ };
      const buffer = await service.generateContractPdf(vm);
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(100);
      expect(buffer.slice(0, 4).toString()).toBe('%PDF');
    });
  });
  // same for receipt and commission...
});
```

### TypeScript note

`PDFDocument` from pdfkit: the type for the `fill` callback parameter is `InstanceType<typeof PDFDocument>`. Import the type as:

```typescript
import PDFDocument from 'pdfkit';
// PDFDocument is both the constructor and type when esModuleInterop is enabled
private streamToBuffer(fill: (doc: InstanceType<typeof PDFDocument>) => void): Promise<Buffer>
```

### date-fns locale

`date-fns` v4 ships locale as named export — import like:

```typescript
import { fr } from 'date-fns/locale';
```

This is already in use in the project (`contracts.service.ts` uses `date-fns` but not the locale). Check if `fr` import works with the `nodenext` resolution.

### Previous story learnings (from Story 0.2)

- **uuid v14 ESM**: `transformIgnorePatterns` already fixed in `package.json`. `pdfkit` is CJS — no issue.
- **`nodenext` imports**: `import X from 'y'` with `esModuleInterop:true` works for CJS packages. Production files need `.js` extensions for internal imports, but test files (ts-jest) don't.
- **Test pattern**: Use `new Service()` directly in tests (no TestingModule needed for pure utilities).

### Files to CREATE

- `src/common/services/pdf-view-models.ts`
- `src/common/services/pdf.service.ts`
- `src/common/services/index.ts`
- `src/common/services/pdf.service.spec.ts`

### Files to NOT TOUCH

- `src/app.module.ts` — PdfService NOT registered here yet (done by consuming story)
- `src/common/events/` — do not touch Story 0.2 output
- Any existing module service

### References

- Architecture §14.2 PdfService: `_bmad-output/planning-artifacts/architecture.md`
- FR-17 (contract PDF), FR-18 (receipt PDF), FR-30 (commission receipt)
- Story 0.2 debug notes: `_bmad-output/implementation-artifacts/0-2-event-emitter2-domain-events.md`
- date-fns usage: `src/contracts/contracts.service.ts` (addDays, addMonths, format already used)

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

- `import PDFDocument from 'pdfkit'` with `esModuleInterop: true` and `nodenext` module resolution works correctly. pdfkit is CJS, no ESM issues. No `transformIgnorePatterns` change needed.
- `date-fns/locale` import `{ fr }` works fine with nodenext resolution.
- The `streamToBuffer` helper uses `InstanceType<typeof PDFDocument>` as the callback parameter type to satisfy TypeScript when the class is imported as a default export.

### Completion Notes List

- Installed `pdfkit` (dependency) and `@types/pdfkit` (devDependency).
- Created `src/common/services/pdf-view-models.ts` with `ContractPdfVm`, `ReceiptPdfVm`, `CommissionReceiptPdfVm` interfaces.
- Created `src/common/services/pdf.service.ts` — `@Injectable()` PdfService with 3 async methods returning `Promise<Buffer>`, plus private `formatFcfa` and `streamToBuffer` helpers.
- Created `src/common/services/index.ts` barrel exporting service and view models.
- Created `src/common/services/pdf.service.spec.ts` — 9 unit tests (3 per method: instanceof Buffer, length > 100, `%PDF` magic bytes). All pass.
- AppModule registration intentionally deferred: adding PdfService to AppModule providers alone does NOT enable injection in child modules in NestJS. The correct wiring (adding to each consuming module's providers array) will be done in Stories 4.5 (ContractsModule) and 5.5 (PaymentsModule) when the service is actually consumed.
- `tsc --noEmit` passes with zero errors.
- Full test suite: 30 tests pass (9 new + 21 pre-existing), zero regressions.

### File List

- `package.json` — added `pdfkit` dependency + `@types/pdfkit` devDependency
- `package-lock.json` — updated by npm install
- `src/common/services/pdf-view-models.ts` — new file: ContractPdfVm, ReceiptPdfVm, CommissionReceiptPdfVm interfaces
- `src/common/services/pdf.service.ts` — new file: PdfService with generateContractPdf, generateReceiptPdf, generateCommissionReceiptPdf
- `src/common/services/index.ts` — new file: barrel export
- `src/common/services/pdf.service.spec.ts` — new file: 9 unit tests
