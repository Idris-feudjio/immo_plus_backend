import { NotFoundException } from '@nestjs/common';
import { ContractsService } from './contracts.service';

// ─── Mock factories ───────────────────────────────────────────────────────────

function mockRepo() {
  return {
    findListPaginated: jest.fn(),
    findByIdWithDetails: jest.fn(),
    findPropertyForContract: jest.fn(),
    findActiveContractForProperty: jest.fn(),
    assertAccess: jest.fn().mockResolvedValue(undefined),
    findByIdForPdf: jest.fn(),
    updatePdfUrl: jest.fn(),
  };
}

function mockUow() {
  return { execute: jest.fn() };
}

function mockPdfService() {
  return { generateContractPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF')) };
}

function mockStorage() {
  return { uploadBuffer: jest.fn().mockResolvedValue('https://r2.example.com/contracts/c-1/contract.pdf') };
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CONTRACT_STUB = {
  id: 'c-1',
  propertyId: 'p-1',
  tenantId: 't-1',
  pdfUrl: null,
  rent: 100000,
  fees: 5000,
  deposit: 200000,
  status: 'ACTIVE',
  startDate: new Date('2026-01-01'),
  endDate: new Date('2026-12-31'),
};

const PDF_DATA_STUB = {
  id: 'c-1',
  rent: 100000,
  fees: 5000,
  deposit: 200000,
  startDate: new Date('2026-01-01'),
  endDate: new Date('2026-12-31'),
  pdfUrl: null,
  property: {
    title: 'Villa Bastos',
    address: '12 Rue des Palmiers',
    city: 'Yaoundé',
    owner: { firstName: 'Marc', lastName: 'Dupont' },
  },
  tenant: { firstName: 'Alice', lastName: 'Ngo', nationalIdNumber: 'CM123456' },
  clauses: [{ text: 'Pas d\'animaux' }, { text: 'Loyer payable le 5' }],
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ContractsService — getPdfUrl', () => {
  let service: ContractsService;
  let repo: ReturnType<typeof mockRepo>;
  let pdfService: ReturnType<typeof mockPdfService>;
  let storage: ReturnType<typeof mockStorage>;

  beforeEach(() => {
    repo = mockRepo();
    pdfService = mockPdfService();
    storage = mockStorage();
    service = new ContractsService(
      repo as never,
      mockUow() as never,
      pdfService as never,
      storage as never,
    );
  });

  it('returns existing pdfUrl without generating when pdfUrl set and force=false', async () => {
    repo.findByIdWithDetails.mockResolvedValue({ ...CONTRACT_STUB, pdfUrl: 'https://r2.example.com/old.pdf' });

    const result = await service.getPdfUrl('c-1', 'user-1', 'OWNER');

    expect(result).toEqual({ pdfUrl: 'https://r2.example.com/old.pdf' });
    expect(pdfService.generateContractPdf).not.toHaveBeenCalled();
    expect(storage.uploadBuffer).not.toHaveBeenCalled();
  });

  it('generates PDF when pdfUrl is null', async () => {
    repo.findByIdWithDetails.mockResolvedValue(CONTRACT_STUB);
    repo.findByIdForPdf.mockResolvedValue(PDF_DATA_STUB);

    const result = await service.getPdfUrl('c-1', 'user-1', 'OWNER');

    expect(pdfService.generateContractPdf).toHaveBeenCalledTimes(1);
    expect(storage.uploadBuffer).toHaveBeenCalledWith(
      'contracts/c-1/contract.pdf',
      expect.any(Buffer),
      'application/pdf',
    );
    expect(repo.updatePdfUrl).toHaveBeenCalledWith('c-1', 'https://r2.example.com/contracts/c-1/contract.pdf');
    expect(result).toEqual({ pdfUrl: 'https://r2.example.com/contracts/c-1/contract.pdf' });
  });

  it('generates PDF when force=true even if pdfUrl already exists', async () => {
    repo.findByIdWithDetails.mockResolvedValue({ ...CONTRACT_STUB, pdfUrl: 'https://r2.example.com/old.pdf' });
    repo.findByIdForPdf.mockResolvedValue(PDF_DATA_STUB);

    await service.getPdfUrl('c-1', 'user-1', 'OWNER', true);

    expect(pdfService.generateContractPdf).toHaveBeenCalledTimes(1);
    expect(storage.uploadBuffer).toHaveBeenCalledTimes(1);
  });

  it('builds ContractPdfVm with correct TVA (19.25%) and owner/tenant info', async () => {
    repo.findByIdWithDetails.mockResolvedValue(CONTRACT_STUB);
    repo.findByIdForPdf.mockResolvedValue(PDF_DATA_STUB);

    await service.getPdfUrl('c-1', 'user-1', 'OWNER');

    const vm = pdfService.generateContractPdf.mock.calls[0][0];
    expect(vm.contractId).toBe('c-1');
    expect(vm.ownerFirstName).toBe('Marc');
    expect(vm.ownerLastName).toBe('Dupont');
    expect(vm.tenantFirstName).toBe('Alice');
    expect(vm.tenantIdNumber).toBe('CM123456');
    expect(vm.rentHT).toBe(100000);
    expect(vm.tvaRate).toBe(19.25);
    expect(vm.tvaAmount).toBe(Math.round(100000 * 0.1925));
    expect(vm.rentTTC).toBe(100000 + Math.round(100000 * 0.1925));
    expect(vm.clauses).toEqual(['Pas d\'animaux', 'Loyer payable le 5']);
  });

  it('throws NotFoundException when findByIdForPdf returns null', async () => {
    repo.findByIdWithDetails.mockResolvedValue(CONTRACT_STUB);
    repo.findByIdForPdf.mockResolvedValue(null);

    await expect(service.getPdfUrl('c-1', 'user-1', 'OWNER')).rejects.toThrow(NotFoundException);
  });
});
