import { PdfService } from './pdf.service';
import type {
  ContractPdfVm,
  ReceiptPdfVm,
  CommissionReceiptPdfVm,
} from './pdf-view-models';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function contractVm(): ContractPdfVm {
  return {
    contractId: 'contract-1',
    lang: 'fr',
    ownerFirstName: 'Jean',
    ownerLastName: 'Dupont',
    ownerAddress: '1 rue des Bougainvilliers, Yaoundé',
    tenantFirstName: 'Marie',
    tenantLastName: 'Ngo',
    tenantIdNumber: 'CMR-12345678',
    propertyTitle: 'Villa Bastos',
    propertyAddress: '23 rue Lac Lobeke',
    propertyCity: 'Yaoundé',
    startDate: new Date('2026-07-01'),
    endDate: new Date('2027-06-30'),
    rentHT: 200000,
    tvaRate: 19.25,
    tvaAmount: 38500,
    rentTTC: 238500,
    fees: 5000,
    deposit: 400000,
    clauses: ['Animaux interdits', 'Sous-location interdite'],
  };
}

function receiptVm(): ReceiptPdfVm {
  return {
    paymentId: 'payment-1',
    contractId: 'contract-1',
    tenantFirstName: 'Marie',
    tenantLastName: 'Ngo',
    propertyTitle: 'Villa Bastos',
    propertyAddress: '23 rue Lac Lobeke',
    propertyCity: 'Yaoundé',
    period: 'Juillet 2026',
    dueDate: new Date('2026-07-05'),
    paymentDate: new Date('2026-07-03'),
    amount: 238500,
    paymentMethod: 'MOBILE_MONEY',
    reference: 'MTN-ABC123',
    ownerFirstName: 'Jean',
    ownerLastName: 'Dupont',
  };
}

function commissionVm(): CommissionReceiptPdfVm {
  return {
    commissionId: 'commission-1',
    agencyName: 'Immo Plus CM',
    agencyAddress: '14 avenue Kennedy, Yaoundé',
    ownerFirstName: 'Jean',
    ownerLastName: 'Dupont',
    propertyTitle: 'Villa Bastos',
    propertyAddress: '23 rue Lac Lobeke',
    type: 'PLACEMENT',
    description: 'Commission de placement locataire',
    amountHT: 50000,
    tvaRate: 19.25,
    tvaAmount: 9625,
    amountTTC: 59625,
    paymentDate: new Date('2026-07-03'),
    paymentMethod: 'VIREMENT',
    reference: 'VIR-001',
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('PdfService', () => {
  let service: PdfService;

  beforeEach(() => {
    service = new PdfService();
  });

  describe('generateContractPdf', () => {
    it('returns a Buffer', async () => {
      const buffer = await service.generateContractPdf(contractVm());
      expect(buffer).toBeInstanceOf(Buffer);
    });

    it('returns a non-empty Buffer (> 100 bytes)', async () => {
      const buffer = await service.generateContractPdf(contractVm());
      expect(buffer.length).toBeGreaterThan(100);
    });

    it('starts with PDF magic bytes %PDF', async () => {
      const buffer = await service.generateContractPdf(contractVm());
      expect(buffer.slice(0, 4).toString('ascii')).toBe('%PDF');
    });
  });

  describe('generateReceiptPdf', () => {
    it('returns a Buffer', async () => {
      const buffer = await service.generateReceiptPdf(receiptVm());
      expect(buffer).toBeInstanceOf(Buffer);
    });

    it('returns a non-empty Buffer (> 100 bytes)', async () => {
      const buffer = await service.generateReceiptPdf(receiptVm());
      expect(buffer.length).toBeGreaterThan(100);
    });

    it('starts with PDF magic bytes %PDF', async () => {
      const buffer = await service.generateReceiptPdf(receiptVm());
      expect(buffer.slice(0, 4).toString('ascii')).toBe('%PDF');
    });
  });

  describe('generateCommissionReceiptPdf', () => {
    it('returns a Buffer', async () => {
      const buffer = await service.generateCommissionReceiptPdf(commissionVm());
      expect(buffer).toBeInstanceOf(Buffer);
    });

    it('returns a non-empty Buffer (> 100 bytes)', async () => {
      const buffer = await service.generateCommissionReceiptPdf(commissionVm());
      expect(buffer.length).toBeGreaterThan(100);
    });

    it('starts with PDF magic bytes %PDF', async () => {
      const buffer = await service.generateCommissionReceiptPdf(commissionVm());
      expect(buffer.slice(0, 4).toString('ascii')).toBe('%PDF');
    });
  });
});
