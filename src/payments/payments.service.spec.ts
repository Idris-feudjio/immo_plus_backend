import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PaymentStatus } from '@prisma/client';
import { PaymentsService } from './payments.service';

// ─── Mock factories ───────────────────────────────────────────────────────────

function mockRepository() {
  return {
    findPaymentById: jest.fn(),
    findPaymentWithProperty: jest.fn(),
    findTenantByUserId: jest.fn(),
    findContractWithProperty: jest.fn(),
    findByContractAndPeriod: jest.fn(),
    createOrUpdate: jest.fn(),
  };
}

function mockStorage() {
  return {
    keyFromUrl: jest.fn((url: string) => url.replace('https://cdn.example.com/', '')),
    getSignedUrl: jest.fn((key: string, _ttl: number) => Promise.resolve(`https://signed.r2.dev/${key}?token=abc`)),
  };
}

function mockPrisma() {
  return {
    property: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    mandate: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    commission: {
      create: jest.fn().mockResolvedValue({}),
    },
  };
}

function mockNotifRepo() {
  return { create: jest.fn().mockResolvedValue({}) };
}

function mockEmailQueue() {
  return { sendEmail: jest.fn().mockResolvedValue(undefined) };
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PAID_PAYMENT = {
  id: 'pay-1',
  status: PaymentStatus.PAID,
  tenantId: 'tenant-uuid-1',
  receiptUrl: 'https://cdn.example.com/receipts/pay-1/receipt.pdf',
  property: { ownerId: 'owner-1', managerId: null },
};

const PENDING_PAYMENT = {
  id: 'pay-2',
  status: PaymentStatus.PENDING,
  tenantId: 'tenant-uuid-1',
  receiptUrl: null,
  property: { ownerId: 'owner-1', managerId: null },
};

const PAID_NO_RECEIPT = {
  id: 'pay-3',
  status: PaymentStatus.PAID,
  tenantId: 'tenant-uuid-1',
  receiptUrl: null,
  property: { ownerId: 'owner-1', managerId: null },
};

const TENANT_RECORD = { id: 'tenant-uuid-1', userId: 'user-tenant-1' };

const CONTRACT_WITH_PROP = {
  id: 'contract-1',
  tenantId: 'tenant-uuid-1',
  propertyId: 'property-1',
  property: { ownerId: 'owner-1', managerId: null },
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('PaymentsService — getReceiptUrl', () => {
  let service: PaymentsService;
  let repo: ReturnType<typeof mockRepository>;
  let storage: ReturnType<typeof mockStorage>;
  let prisma: ReturnType<typeof mockPrisma>;

  beforeEach(() => {
    repo = mockRepository();
    storage = mockStorage();
    prisma = mockPrisma();
    service = new PaymentsService(repo as never, storage as never, prisma as never, mockNotifRepo() as never, mockEmailQueue() as never);
  });

  describe('OWNER / ADMIN flow', () => {
    it('returns pre-signed URL for PAID payment', async () => {
      repo.findPaymentWithProperty.mockResolvedValue(PAID_PAYMENT);
      repo.findPaymentById.mockResolvedValue(PAID_PAYMENT);

      const result = await service.getReceiptUrl('pay-1', 'owner-1', 'OWNER');

      expect(result.receiptUrl).toContain('signed.r2.dev');
      expect(storage.keyFromUrl).toHaveBeenCalledWith(PAID_PAYMENT.receiptUrl);
      expect(storage.getSignedUrl).toHaveBeenCalledWith(
        'receipts/pay-1/receipt.pdf',
        3600,
      );
    });

    it('throws 409 ConflictException when payment is not PAID', async () => {
      repo.findPaymentWithProperty.mockResolvedValue(PENDING_PAYMENT);
      repo.findPaymentById.mockResolvedValue(PENDING_PAYMENT);

      await expect(service.getReceiptUrl('pay-2', 'owner-1', 'OWNER')).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws 404 when payment is PAID but receiptUrl is absent', async () => {
      repo.findPaymentWithProperty.mockResolvedValue(PAID_NO_RECEIPT);
      repo.findPaymentById.mockResolvedValue(PAID_NO_RECEIPT);

      await expect(service.getReceiptUrl('pay-3', 'owner-1', 'OWNER')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws 404 when findPaymentById returns null (race condition)', async () => {
      repo.findPaymentWithProperty.mockResolvedValue(PAID_PAYMENT);
      repo.findPaymentById.mockResolvedValue(null);

      await expect(service.getReceiptUrl('pay-1', 'owner-1', 'OWNER')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('ADMIN bypasses property ownership check', async () => {
      repo.findPaymentWithProperty.mockResolvedValue(PAID_PAYMENT);
      repo.findPaymentById.mockResolvedValue(PAID_PAYMENT);

      const result = await service.getReceiptUrl('pay-1', 'admin-1', 'ADMIN');

      expect(result.receiptUrl).toContain('signed.r2.dev');
    });
  });

  describe('TENANT flow', () => {
    it('returns pre-signed URL when tenant is linked to the payment', async () => {
      repo.findPaymentById.mockResolvedValue(PAID_PAYMENT);
      repo.findTenantByUserId.mockResolvedValue(TENANT_RECORD);

      const result = await service.getReceiptUrl('pay-1', 'user-tenant-1', 'TENANT');

      expect(result.receiptUrl).toContain('signed.r2.dev');
      expect(repo.findPaymentWithProperty).not.toHaveBeenCalled();
    });

    it('throws 403 when tenant is not linked to the payment', async () => {
      repo.findPaymentById.mockResolvedValue(PAID_PAYMENT);
      repo.findTenantByUserId.mockResolvedValue({ id: 'tenant-uuid-OTHER', userId: 'user-tenant-2' });

      await expect(service.getReceiptUrl('pay-1', 'user-tenant-2', 'TENANT')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws 403 when no tenant record exists for userId', async () => {
      repo.findPaymentById.mockResolvedValue(PAID_PAYMENT);
      repo.findTenantByUserId.mockResolvedValue(null);

      await expect(service.getReceiptUrl('pay-1', 'user-tenant-1', 'TENANT')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws 404 when payment not found (TENANT path)', async () => {
      repo.findPaymentById.mockResolvedValue(null);

      await expect(service.getReceiptUrl('pay-x', 'user-tenant-1', 'TENANT')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws 409 when payment is not PAID (TENANT path)', async () => {
      repo.findPaymentById.mockResolvedValue(PENDING_PAYMENT);
      repo.findTenantByUserId.mockResolvedValue(TENANT_RECORD);

      await expect(service.getReceiptUrl('pay-2', 'user-tenant-1', 'TENANT')).rejects.toThrow(
        ConflictException,
      );
    });

    it('uses 3600s TTL for pre-signed URL', async () => {
      repo.findPaymentById.mockResolvedValue(PAID_PAYMENT);
      repo.findTenantByUserId.mockResolvedValue(TENANT_RECORD);

      await service.getReceiptUrl('pay-1', 'user-tenant-1', 'TENANT');

      expect(storage.getSignedUrl).toHaveBeenCalledWith(expect.any(String), 3600);
    });
  });
});

// ─── Commission generation tests ─────────────────────────────────────────────

describe('PaymentsService — generateCommissions (Story 7.7)', () => {
  let service: PaymentsService;
  let repo: ReturnType<typeof mockRepository>;
  let storage: ReturnType<typeof mockStorage>;
  let prisma: ReturnType<typeof mockPrisma>;

  beforeEach(() => {
    repo = mockRepository();
    storage = mockStorage();
    prisma = mockPrisma();
    service = new PaymentsService(repo as never, storage as never, prisma as never, mockNotifRepo() as never, mockEmailQueue() as never);

    // Default: new payment created
    repo.findContractWithProperty.mockResolvedValue(CONTRACT_WITH_PROP);
    repo.findByContractAndPeriod.mockResolvedValue(null); // isNew = true
    repo.createOrUpdate.mockResolvedValue({ id: 'pay-new', status: PaymentStatus.PAID });
  });

  it('creates PERCENTAGE commission correctly for a new PAID payment', async () => {
    prisma.mandate.findMany.mockResolvedValue([
      {
        id: 'mandate-1',
        agencyId: 'agency-1',
        commissionType: 'PERCENTAGE',
        commissionValue: { toString: () => '10', valueOf: () => 10 },
      },
    ]);

    await service.createPayment('owner-1', 'OWNER', {
      contractId: 'contract-1',
      amount: 150000,
      period: '2026-01',
      dueDate: '2026-01-31',
      status: PaymentStatus.PAID,
    } as never);

    expect(prisma.commission.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          amountHT: 15000, // 10% of 150000
          mandateId: 'mandate-1',
          agencyId: 'agency-1',
          type: 'MANAGEMENT',
          status: 'PENDING',
        }),
      }),
    );
  });

  it('creates FIXED commission correctly for a new PAID payment', async () => {
    prisma.mandate.findMany.mockResolvedValue([
      {
        id: 'mandate-2',
        agencyId: 'agency-1',
        commissionType: 'FIXED',
        commissionValue: { toString: () => '25000', valueOf: () => 25000 },
      },
    ]);

    await service.createPayment('owner-1', 'OWNER', {
      contractId: 'contract-1',
      amount: 150000,
      period: '2026-01',
      dueDate: '2026-01-31',
      status: PaymentStatus.PAID,
    } as never);

    expect(prisma.commission.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          amountHT: 25000,
        }),
      }),
    );
  });

  it('does not create commission when mandate has no commissionType', async () => {
    prisma.mandate.findMany.mockResolvedValue([]); // DB filters commissionType: { not: null }

    await service.createPayment('owner-1', 'OWNER', {
      contractId: 'contract-1',
      amount: 150000,
      period: '2026-01',
      dueDate: '2026-01-31',
      status: PaymentStatus.PAID,
    } as never);

    expect(prisma.commission.create).not.toHaveBeenCalled();
  });
});
