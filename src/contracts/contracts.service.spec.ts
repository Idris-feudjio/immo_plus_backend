import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ContractsService } from './contracts.service';

// ─── Mock factories ───────────────────────────────────────────────────────────

function mockRepo() {
  return {
    findByIdWithDetails: jest.fn(),
    findBySignatureToken: jest.fn(),
    findPropertyForContract: jest.fn(),
    findActiveContractForProperty: jest.fn(),
    findPropertyById: jest
      .fn()
      .mockResolvedValue({ ownerId: 'user-1', managerId: null }),
    findTenantByUserId: jest.fn(),
    findTenantById: jest.fn(),
    findAcceptedApplication: jest.fn(),
    findByIdForPdf: jest.fn(),
  };
}

function mockUow() {
  return {
    execute: jest.fn((fn: (tx: unknown) => unknown) => fn(mockTx())),
  };
}

function mockTx() {
  return {
    contract: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    property: {
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    payment: { updateMany: jest.fn() },
    notification: { create: jest.fn() },
  };
}

function mockPdfService() {
  return {
    generateContractPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF')),
  };
}

function mockStorage() {
  return {
    uploadBuffer: jest
      .fn()
      .mockResolvedValue('https://r2.example.com/contracts/c-1/contract.pdf'),
    getSignedUrl: jest
      .fn()
      .mockResolvedValue(
        'https://r2.example.com/signed/contracts/c-1/contract.pdf',
      ),
  };
}

function mockEmailQueue() {
  return { sendEmail: jest.fn().mockResolvedValue(undefined) };
}

function mockContractTemplates() {
  return { getOneScoped: jest.fn() };
}

function buildService() {
  const repo = mockRepo();
  const uow = mockUow();
  const pdfService = mockPdfService();
  const storage = mockStorage();
  const emailQueue = mockEmailQueue();
  const contractTemplates = mockContractTemplates();
  const service = new ContractsService(
    repo as never,
    uow as never,
    pdfService as never,
    storage as never,
    emailQueue as never,
    contractTemplates as never,
  );
  return {
    service,
    repo,
    uow,
    pdfService,
    storage,
    emailQueue,
    contractTemplates,
  };
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PROPERTY_STUB = {
  id: 'p-1',
  ownerId: 'user-1',
  managerId: null,
  status: 'AVAILABLE',
};
const TENANT_STUB = { id: 't-1', email: 'tenant@test.cm' };
const APPLICATION_STUB = { id: 'app-1', status: 'ACCEPTED' };

const CREATE_DTO = {
  propertyId: 'p-1',
  tenantId: 't-1',
  startDate: '2026-01-01',
  endDate: '2026-12-31',
  rent: 100000,
  deposit: 200000,
};

const CONTRACT_STUB = {
  id: 'c-1',
  propertyId: 'p-1',
  tenantId: 't-1',
  parentContractId: null,
  pdfUrl: null,
  pdfLang: null,
  rent: 100000,
  fees: 5000,
  deposit: 200000,
  status: 'ACTIVE',
  startDate: new Date('2026-01-01'),
  endDate: new Date('2026-12-31'),
};

const PDF_DATA_STUB = {
  id: 'c-1',
  status: 'DRAFT',
  rent: 100000,
  fees: 5000,
  deposit: 200000,
  tvaRate: 19.25,
  tvaAmount: 19250,
  startDate: new Date('2026-01-01'),
  endDate: new Date('2026-12-31'),
  pdfUrl: null,
  pdfLang: null,
  property: {
    title: 'Villa Bastos',
    address: '12 Rue des Palmiers',
    city: 'Yaoundé',
    owner: { firstName: 'Marc', lastName: 'Dupont' },
  },
  tenant: {
    firstName: 'Alice',
    lastName: 'Ngo',
    nationalIdNumber: 'CM123456',
    email: 'alice@test.cm',
  },
  clauses: [{ text: "Pas d'animaux" }],
};

// ─── createContract ───────────────────────────────────────────────────────────

describe('ContractsService — createContract', () => {
  it('throws when the property is not AVAILABLE', async () => {
    const { service, repo } = buildService();
    repo.findPropertyForContract.mockResolvedValue({
      ...PROPERTY_STUB,
      status: 'RENTED',
    });

    await expect(
      service.createContract('user-1', 'OWNER', CREATE_DTO),
    ).rejects.toThrow(ConflictException);
  });

  it('throws when the tenant does not exist', async () => {
    const { service, repo } = buildService();
    repo.findPropertyForContract.mockResolvedValue(PROPERTY_STUB);
    repo.findTenantById.mockResolvedValue(null);

    await expect(
      service.createContract('user-1', 'OWNER', CREATE_DTO),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws when the tenant has no ACCEPTED application for the property', async () => {
    const { service, repo } = buildService();
    repo.findPropertyForContract.mockResolvedValue(PROPERTY_STUB);
    repo.findTenantById.mockResolvedValue(TENANT_STUB);
    repo.findAcceptedApplication.mockResolvedValue(null);

    await expect(
      service.createContract('user-1', 'OWNER', CREATE_DTO),
    ).rejects.toThrow(ConflictException);
  });

  it('throws BadRequestException when endDate is not after startDate', async () => {
    const { service, repo } = buildService();
    repo.findPropertyForContract.mockResolvedValue(PROPERTY_STUB);
    repo.findTenantById.mockResolvedValue(TENANT_STUB);
    repo.findAcceptedApplication.mockResolvedValue(APPLICATION_STUB);

    await expect(
      service.createContract('user-1', 'OWNER', {
        ...CREATE_DTO,
        startDate: '2026-06-01',
        endDate: '2026-01-01',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('creates the contract as DRAFT with a snapshotted TVA amount', async () => {
    const { service, repo, uow } = buildService();
    repo.findPropertyForContract.mockResolvedValue(PROPERTY_STUB);
    repo.findTenantById.mockResolvedValue(TENANT_STUB);
    repo.findAcceptedApplication.mockResolvedValue(APPLICATION_STUB);

    await service.createContract('user-1', 'OWNER', CREATE_DTO);

    expect(uow.execute).toHaveBeenCalled();
  });
});

// ─── getPdfUrl ────────────────────────────────────────────────────────────────

describe('ContractsService — getPdfUrl', () => {
  it('returns a signed URL without regenerating when pdfUrl and pdfLang already match', async () => {
    const { service, repo, pdfService, storage } = buildService();
    repo.findByIdWithDetails.mockResolvedValue({
      ...CONTRACT_STUB,
      status: 'ACTIVE',
      pdfUrl: 'contracts/c-1/contract.pdf',
      pdfLang: 'fr',
    });

    const result = await service.getPdfUrl('c-1', 'user-1', 'OWNER', 'fr');

    expect(pdfService.generateContractPdf).not.toHaveBeenCalled();
    expect(storage.getSignedUrl).toHaveBeenCalledWith(
      'contracts/c-1/contract.pdf',
      24 * 3600,
    );
    expect(result).toEqual({
      pdfUrl: 'https://r2.example.com/signed/contracts/c-1/contract.pdf',
    });
  });

  it('regenerates when the cached PDF language does not match the requested language', async () => {
    const { service, repo, pdfService } = buildService();
    repo.findByIdWithDetails.mockResolvedValue({
      ...CONTRACT_STUB,
      status: 'ACTIVE',
      pdfUrl: 'contracts/c-1/contract.pdf',
      pdfLang: 'fr',
    });
    repo.findByIdForPdf.mockResolvedValue(PDF_DATA_STUB);

    await service.getPdfUrl('c-1', 'user-1', 'OWNER', 'en');

    expect(pdfService.generateContractPdf).toHaveBeenCalledTimes(1);
    expect(pdfService.generateContractPdf).toHaveBeenCalledWith(
      expect.objectContaining({ lang: 'en' }),
    );
  });

  it('regenerates when force=true even if the language already matches', async () => {
    const { service, repo, pdfService } = buildService();
    repo.findByIdWithDetails.mockResolvedValue({
      ...CONTRACT_STUB,
      status: 'ACTIVE',
      pdfUrl: 'contracts/c-1/contract.pdf',
      pdfLang: 'fr',
    });
    repo.findByIdForPdf.mockResolvedValue(PDF_DATA_STUB);

    await service.getPdfUrl('c-1', 'user-1', 'OWNER', 'fr', true);

    expect(pdfService.generateContractPdf).toHaveBeenCalledTimes(1);
  });

  it('transitions DRAFT to PENDING_SIGNATURE and sends the acceptance email when the caller is not a TENANT', async () => {
    const { service, repo, emailQueue, uow } = buildService();
    repo.findByIdWithDetails.mockResolvedValue({
      ...CONTRACT_STUB,
      status: 'DRAFT',
      pdfUrl: null,
      pdfLang: null,
    });
    repo.findByIdForPdf.mockResolvedValue({
      ...PDF_DATA_STUB,
      status: 'DRAFT',
    });

    await service.getPdfUrl('c-1', 'user-1', 'OWNER', 'fr');
    await new Promise((r) => setImmediate(r));

    expect(uow.execute).toHaveBeenCalled();
    expect(emailQueue.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'alice@test.cm',
        template: 'contract-acceptance-request',
      }),
    );
  });

  it('does NOT transition a DRAFT contract when the caller is a TENANT', async () => {
    const { service, repo, emailQueue } = buildService();
    repo.findByIdWithDetails.mockResolvedValue({
      ...CONTRACT_STUB,
      status: 'DRAFT',
      pdfUrl: null,
      pdfLang: null,
      tenantId: 't-1',
    });
    repo.findTenantByUserId.mockResolvedValue({ id: 't-1' });
    repo.findByIdForPdf.mockResolvedValue({
      ...PDF_DATA_STUB,
      status: 'DRAFT',
    });

    await service.getPdfUrl('c-1', 'user-1', 'TENANT', 'fr');
    await new Promise((r) => setImmediate(r));

    expect(emailQueue.sendEmail).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when findByIdForPdf returns null on regeneration', async () => {
    const { service, repo } = buildService();
    repo.findByIdWithDetails.mockResolvedValue({
      ...CONTRACT_STUB,
      status: 'ACTIVE',
      pdfUrl: null,
      pdfLang: null,
    });
    repo.findByIdForPdf.mockResolvedValue(null);

    await expect(service.getPdfUrl('c-1', 'user-1', 'OWNER')).rejects.toThrow(
      NotFoundException,
    );
  });
});

// ─── acceptContract / getAcceptanceSummary ─────────────────────────────────────

describe('ContractsService — acceptContract', () => {
  const PENDING_CONTRACT = {
    id: 'c-1',
    propertyId: 'p-1',
    parentContractId: null,
    status: 'PENDING_SIGNATURE',
    signatureTokenExpiresAt: new Date(Date.now() + 86400000),
    rent: 100000,
    startDate: new Date('2026-01-01'),
    endDate: new Date('2026-12-31'),
    property: { title: 'Villa Bastos', city: 'Yaoundé' },
    tenant: { firstName: 'Alice', lastName: 'Ngo' },
  };

  it('throws NotFoundException for an unknown token', async () => {
    const { service, repo } = buildService();
    repo.findBySignatureToken.mockResolvedValue(null);

    await expect(service.getAcceptanceSummary('bad-token')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('throws BadRequestException (400) when the token is expired', async () => {
    const { service, repo } = buildService();
    repo.findBySignatureToken.mockResolvedValue({
      ...PENDING_CONTRACT,
      signatureTokenExpiresAt: new Date(Date.now() - 1000),
    });

    await expect(service.getAcceptanceSummary('token')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('returns already_accepted (not an error) for an ACTIVE contract', async () => {
    const { service, repo } = buildService();
    repo.findBySignatureToken.mockResolvedValue({
      ...PENDING_CONTRACT,
      status: 'ACTIVE',
    });

    const result = await service.getAcceptanceSummary('token');

    expect(result).toEqual({ status: 'already_accepted' });
  });

  it('returns the pending summary shape expected by the acceptance page', async () => {
    const { service, repo } = buildService();
    repo.findBySignatureToken.mockResolvedValue(PENDING_CONTRACT);

    const result = await service.getAcceptanceSummary('token');

    expect(result).toEqual({
      status: 'pending',
      propertyTitle: 'Villa Bastos',
      propertyCity: 'Yaoundé',
      tenantName: 'Alice Ngo',
      rent: 100000,
      startDate: PENDING_CONTRACT.startDate.toISOString(),
      endDate: PENDING_CONTRACT.endDate.toISOString(),
    });
  });

  it('accepts a pending contract, claims the property, and returns status "accepted"', async () => {
    const { service, repo, uow } = buildService();
    repo.findBySignatureToken.mockResolvedValue(PENDING_CONTRACT);
    repo.findByIdForPdf.mockResolvedValue(PDF_DATA_STUB);

    const result = await service.acceptContract('token', '127.0.0.1');

    expect(uow.execute).toHaveBeenCalled();
    expect(result).toEqual({ status: 'accepted' });
  });

  it('expires the parent contract when accepting a renewal', async () => {
    const { service, repo, uow } = buildService();
    repo.findBySignatureToken.mockResolvedValue({
      ...PENDING_CONTRACT,
      parentContractId: 'c-0',
    });
    repo.findByIdForPdf.mockResolvedValue(PDF_DATA_STUB);

    const tx = mockTx();
    uow.execute.mockImplementationOnce((fn: (t: unknown) => unknown) => fn(tx));

    await service.acceptContract('token', '127.0.0.1');

    expect(tx.contract.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'c-0', status: 'RENEWAL' },
        data: { status: 'EXPIRED' },
      }),
    );
  });

  it('rejects acceptance when a different contract already holds the property ACTIVE (renewal race)', async () => {
    const { service, repo, uow } = buildService();
    repo.findBySignatureToken.mockResolvedValue({
      ...PENDING_CONTRACT,
      parentContractId: 'c-0',
    });

    const tx = mockTx();
    tx.contract.findFirst.mockResolvedValue({ id: 'other-active-contract' });
    uow.execute.mockImplementationOnce((fn: (t: unknown) => unknown) => fn(tx));

    await expect(service.acceptContract('token', '127.0.0.1')).rejects.toThrow(
      ConflictException,
    );
  });
});

// ─── renew ────────────────────────────────────────────────────────────────────

describe('ContractsService — renew', () => {
  it('throws ConflictException when the contract is not in a renewable status', async () => {
    const { service, repo } = buildService();
    repo.findByIdWithDetails.mockResolvedValue({
      ...CONTRACT_STUB,
      status: 'DRAFT',
    });

    await expect(
      service.renew('c-1', 'user-1', 'OWNER', { endDate: '2027-12-31' }),
    ).rejects.toThrow(ConflictException);
  });

  it('throws BadRequestException when the new endDate is not after the new startDate', async () => {
    const { service, repo } = buildService();
    repo.findByIdWithDetails.mockResolvedValue({
      ...CONTRACT_STUB,
      status: 'ACTIVE',
      endDate: new Date('2026-12-31'),
    });

    await expect(
      service.renew('c-1', 'user-1', 'OWNER', { endDate: '2026-01-01' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('creates the renewal as DRAFT with parentContractId set', async () => {
    const { service, repo, uow } = buildService();
    repo.findByIdWithDetails.mockResolvedValue({
      ...CONTRACT_STUB,
      status: 'ACTIVE',
    });
    const tx = mockTx();
    uow.execute.mockImplementationOnce((fn: (t: unknown) => unknown) => fn(tx));

    await service.renew('c-1', 'user-1', 'OWNER', { endDate: '2027-12-31' });

    expect(tx.contract.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          parentContractId: 'c-1',
          status: 'DRAFT',
        }),
      }),
    );
  });

  it('throws ConflictException when the atomic status guard loses the race (already renewed concurrently)', async () => {
    const { service, repo, uow } = buildService();
    repo.findByIdWithDetails.mockResolvedValue({
      ...CONTRACT_STUB,
      status: 'ACTIVE',
    });
    const tx = mockTx();
    tx.contract.updateMany.mockResolvedValue({ count: 0 });
    uow.execute.mockImplementationOnce((fn: (t: unknown) => unknown) => fn(tx));

    await expect(
      service.renew('c-1', 'user-1', 'OWNER', { endDate: '2027-12-31' }),
    ).rejects.toThrow(ConflictException);
  });
});

// ─── terminate ────────────────────────────────────────────────────────────────

describe('ContractsService — terminate', () => {
  const TERMINATE_DTO = { terminationDate: '2026-06-01' };

  it('terminates an ACTIVE contract and releases the property', async () => {
    const { service, repo, uow } = buildService();
    repo.findByIdWithDetails.mockResolvedValue({
      ...CONTRACT_STUB,
      status: 'ACTIVE',
    });
    repo.findByIdForPdf.mockResolvedValue(PDF_DATA_STUB);

    const result = await service.terminate(
      'c-1',
      'user-1',
      'OWNER',
      TERMINATE_DTO,
    );

    expect(uow.execute).toHaveBeenCalled();
    expect(result).toEqual({ message: 'Contrat résilié avec succès.' });
  });

  it('throws ConflictException when the contract is not ACTIVE', async () => {
    const { service, repo, uow } = buildService();
    repo.findByIdWithDetails.mockResolvedValue({
      ...CONTRACT_STUB,
      status: 'TERMINATED',
    });
    const tx = mockTx();
    tx.contract.updateMany.mockResolvedValue({ count: 0 });
    uow.execute.mockImplementationOnce((fn: (t: unknown) => unknown) => fn(tx));

    await expect(
      service.terminate('c-1', 'user-1', 'OWNER', TERMINATE_DTO),
    ).rejects.toThrow(ConflictException);
  });
});

// ─── checkAccess / search scoping ───────────────────────────────────────────────

describe('ContractsService — role-based access', () => {
  it('rejects a TENANT reading a contract that is not theirs', async () => {
    const { service, repo } = buildService();
    repo.findByIdWithDetails.mockResolvedValue({
      ...CONTRACT_STUB,
      tenantId: 't-other',
    });
    repo.findTenantByUserId.mockResolvedValue({ id: 't-1' });

    await expect(service.getById('c-1', 'user-1', 'TENANT')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('scopes a MANAGER search by property.managerId, not ownerId', async () => {
    const { service } = buildService();
    const spy = jest
      .spyOn(service, 'findWithPagination' as never)
      .mockResolvedValue({ data: [], meta: {} } as never);

    await service.search('mgr-1', 'MANAGER', {});

    expect(spy).toHaveBeenCalledWith({}, { property: { managerId: 'mgr-1' } });
  });
});
