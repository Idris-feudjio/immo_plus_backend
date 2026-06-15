import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { CommissionCategory, CommissionStatus, Role } from '@prisma/client';
import { CommissionsService } from './commissions.service';

// ─── Mock factories ───────────────────────────────────────────────────────────

function mockRepository() {
  return {
    findById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    findPaginated: jest.fn(),
    getDashboardStats: jest.fn(),
    getOwnerDue: jest.fn(),
  };
}

function mockPrisma() {
  return {
    contract: { findUnique: jest.fn() },
    mandate: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
    agencyMember: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
  };
}

function mockNotifRepo() {
  return { create: jest.fn().mockResolvedValue({}) };
}

function mockEmailQueue() {
  return { sendEmail: jest.fn().mockResolvedValue(undefined) };
}

function mockStorage() {
  return {
    uploadBuffer: jest.fn((key: string) => Promise.resolve(`https://cdn.r2.dev/${key}`)),
  };
}

function mockPdf() {
  return {
    generateCommissionReceiptPdf: jest.fn().mockResolvedValue(Buffer.from('pdf')),
  };
}

function mockCache() {
  return {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
  };
}

function mockMandateRepo() {
  return { findActiveByManager: jest.fn() };
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CONTRACT = {
  id: 'contract-1',
  propertyId: 'prop-1',
  property: {
    id: 'prop-1',
    title: 'Villa Bastos',
    ownerId: 'owner-1',
    owner: { id: 'owner-1', email: 'owner@test.cm', firstName: 'Marc', lastName: 'Dupont' },
  },
};

const MANDATE = { id: 'mandate-1', agencyId: 'agency-1' };

const PENDING_COMMISSION = {
  id: 'comm-1',
  agencyId: 'agency-1',
  status: CommissionStatus.PENDING,
  type: CommissionCategory.PLACEMENT,
  amountHT: 100000,
  tvaRate: 19.25,
  tvaAmount: 19250,
  amountTTC: 119250,
  description: null,
  mandate: {
    id: 'mandate-1',
    managerId: 'manager-1',
    manager: { id: 'manager-1', email: 'mgr@test.cm', firstName: 'Jean', lastName: 'Foe' },
  },
  agency: { id: 'agency-1', name: 'SARL Immobil', address: 'Rue 1, Yaoundé' },
  contract: CONTRACT,
};

const PAID_COMMISSION = { ...PENDING_COMMISSION, id: 'comm-2', status: CommissionStatus.PAID };

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CommissionsService', () => {
  let service: CommissionsService;
  let repository: ReturnType<typeof mockRepository>;
  let prisma: ReturnType<typeof mockPrisma>;
  let notifRepo: ReturnType<typeof mockNotifRepo>;
  let emailQueue: ReturnType<typeof mockEmailQueue>;
  let storage: ReturnType<typeof mockStorage>;
  let pdf: ReturnType<typeof mockPdf>;
  let cache: ReturnType<typeof mockCache>;
  let mandateRepo: ReturnType<typeof mockMandateRepo>;

  beforeEach(() => {
    repository = mockRepository();
    prisma = mockPrisma();
    notifRepo = mockNotifRepo();
    emailQueue = mockEmailQueue();
    storage = mockStorage();
    pdf = mockPdf();
    cache = mockCache();
    mandateRepo = mockMandateRepo();
    service = new CommissionsService(
      repository as never,
      prisma as never,
      notifRepo as never,
      emailQueue as never,
      storage as never,
      pdf as never,
      cache as never,
      mandateRepo as never,
    );
  });

  // ── Story 8.2: create ─────────────────────────────────────────────────────

  describe('create (Story 8.2)', () => {
    const DTO = {
      contractId: 'contract-1',
      type: CommissionCategory.PLACEMENT,
      amountHT: 100000,
    };

    it('MANAGER with active mandate creates a commission', async () => {
      prisma.contract.findUnique.mockResolvedValue(CONTRACT);
      mandateRepo.findActiveByManager.mockResolvedValue({ id: 'mandate-1' });
      prisma.mandate.findUnique.mockResolvedValue(MANDATE);
      repository.create.mockResolvedValue({ ...PENDING_COMMISSION, amountHT: 100000 });

      const result = await service.create('manager-1', Role.MANAGER, DTO);

      expect(result.amountHT).toBe(100000);
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: CommissionCategory.PLACEMENT,
          amountHT: 100000,
          tvaAmount: 19250,
          amountTTC: 119250,
          status: CommissionStatus.PENDING,
          agencyId: 'agency-1',
        }),
      );
    });

    it('TVA calculated at 19.25%: amountHT=100000 → tvaAmount=19250, amountTTC=119250', async () => {
      prisma.contract.findUnique.mockResolvedValue(CONTRACT);
      mandateRepo.findActiveByManager.mockResolvedValue({ id: 'mandate-1' });
      prisma.mandate.findUnique.mockResolvedValue(MANDATE);
      repository.create.mockResolvedValue(PENDING_COMMISSION);

      await service.create('manager-1', Role.MANAGER, DTO);

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ tvaAmount: 19250, amountTTC: 119250 }),
      );
    });

    it('MANAGER without active mandate throws 403', async () => {
      prisma.contract.findUnique.mockResolvedValue(CONTRACT);
      mandateRepo.findActiveByManager.mockResolvedValue(null);

      await expect(service.create('manager-x', Role.MANAGER, DTO)).rejects.toThrow(ForbiddenException);
    });

    it('ADMIN with mandateId creates commission', async () => {
      prisma.contract.findUnique.mockResolvedValue(CONTRACT);
      prisma.mandate.findUnique.mockResolvedValue(MANDATE);
      repository.create.mockResolvedValue(PENDING_COMMISSION);

      await service.create('admin-1', Role.ADMIN, { ...DTO, mandateId: 'mandate-1' });

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ agencyId: 'agency-1', mandateId: 'mandate-1' }),
      );
    });

    it('ADMIN with agencyId (no mandateId) creates commission', async () => {
      prisma.contract.findUnique.mockResolvedValue(CONTRACT);
      repository.create.mockResolvedValue(PENDING_COMMISSION);

      await service.create('admin-1', Role.ADMIN, { ...DTO, agencyId: 'agency-1' });

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ agencyId: 'agency-1' }),
      );
    });

    it('Owner is notified via in-app notification', async () => {
      prisma.contract.findUnique.mockResolvedValue(CONTRACT);
      mandateRepo.findActiveByManager.mockResolvedValue({ id: 'mandate-1' });
      prisma.mandate.findUnique.mockResolvedValue(MANDATE);
      repository.create.mockResolvedValue(PENDING_COMMISSION);

      await service.create('manager-1', Role.MANAGER, DTO);

      expect(notifRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'owner-1', type: 'commission_generated' }),
      );
    });

    it('Owner email is queued after commission creation', async () => {
      prisma.contract.findUnique.mockResolvedValue(CONTRACT);
      mandateRepo.findActiveByManager.mockResolvedValue({ id: 'mandate-1' });
      prisma.mandate.findUnique.mockResolvedValue(MANDATE);
      repository.create.mockResolvedValue(PENDING_COMMISSION);

      await service.create('manager-1', Role.MANAGER, DTO);

      expect(emailQueue.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'owner@test.cm', template: 'commission-generated' }),
      );
    });

    it('throws 404 when contract not found', async () => {
      prisma.contract.findUnique.mockResolvedValue(null);

      await expect(service.create('manager-1', Role.MANAGER, DTO)).rejects.toThrow(NotFoundException);
    });
  });

  // ── Story 8.3: pay ────────────────────────────────────────────────────────

  describe('pay (Story 8.3)', () => {
    const PAY_DTO = { paymentMethod: 'BANK_TRANSFER', reference: 'REF-001' };

    it('OWNER pays PENDING commission — status becomes PAID', async () => {
      repository.findById.mockResolvedValue(PENDING_COMMISSION);
      repository.update.mockResolvedValue({ ...PENDING_COMMISSION, status: CommissionStatus.PAID });

      const result = await service.pay('comm-1', 'owner-1', Role.OWNER, PAY_DTO);

      expect(result.status).toBe(CommissionStatus.PAID);
    });

    it('PDF is generated and uploaded to R2', async () => {
      repository.findById.mockResolvedValue(PENDING_COMMISSION);
      repository.update.mockResolvedValue({ ...PENDING_COMMISSION, status: CommissionStatus.PAID });

      await service.pay('comm-1', 'owner-1', Role.OWNER, PAY_DTO);

      expect(pdf.generateCommissionReceiptPdf).toHaveBeenCalledTimes(1);
      expect(storage.uploadBuffer).toHaveBeenCalledWith(
        'commissions/comm-1/receipt.pdf',
        expect.any(Buffer),
        'application/pdf',
      );
    });

    it('receiptUrl stored on commission record', async () => {
      repository.findById.mockResolvedValue(PENDING_COMMISSION);
      repository.update.mockResolvedValue({ ...PENDING_COMMISSION, status: CommissionStatus.PAID });

      await service.pay('comm-1', 'owner-1', Role.OWNER, PAY_DTO);

      expect(repository.update).toHaveBeenCalledWith(
        'comm-1',
        expect.objectContaining({
          receiptUrl: expect.stringContaining('commissions/comm-1/receipt.pdf'),
        }),
      );
    });

    it('Manager is notified after payment', async () => {
      repository.findById.mockResolvedValue(PENDING_COMMISSION);
      repository.update.mockResolvedValue({ ...PENDING_COMMISSION, status: CommissionStatus.PAID });

      await service.pay('comm-1', 'owner-1', Role.OWNER, PAY_DTO);

      expect(notifRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'manager-1', type: 'commission_paid' }),
      );
      expect(emailQueue.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'mgr@test.cm', template: 'commission-paid' }),
      );
    });

    it('throws 409 when commission is not PENDING', async () => {
      repository.findById.mockResolvedValue(PAID_COMMISSION);

      await expect(service.pay('comm-2', 'owner-1', Role.OWNER, PAY_DTO)).rejects.toThrow(ConflictException);
    });

    it('throws 403 when userId is not the property owner', async () => {
      repository.findById.mockResolvedValue(PENDING_COMMISSION);

      await expect(service.pay('comm-1', 'other-user', Role.OWNER, PAY_DTO)).rejects.toThrow(ForbiddenException);
    });

    it('throws 404 when commission not found', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.pay('missing', 'owner-1', Role.OWNER, PAY_DTO)).rejects.toThrow(NotFoundException);
    });
  });

  // ── Story 8.4: cancel ─────────────────────────────────────────────────────

  describe('cancel (Story 8.4)', () => {
    it('OWNER cancels PENDING commission', async () => {
      repository.findById.mockResolvedValue(PENDING_COMMISSION);
      repository.update.mockResolvedValue({ ...PENDING_COMMISSION, status: CommissionStatus.CANCELLED });

      const result = await service.cancel('comm-1', 'owner-1', Role.OWNER);

      expect(repository.update).toHaveBeenCalledWith('comm-1', { status: CommissionStatus.CANCELLED });
      expect(result.status).toBe(CommissionStatus.CANCELLED);
    });

    it('ADMIN cancels PENDING commission', async () => {
      repository.findById.mockResolvedValue(PENDING_COMMISSION);
      repository.update.mockResolvedValue({ ...PENDING_COMMISSION, status: CommissionStatus.CANCELLED });

      await service.cancel('comm-1', 'admin-1', Role.ADMIN);

      expect(repository.update).toHaveBeenCalledWith('comm-1', { status: CommissionStatus.CANCELLED });
    });

    it('throws 409 when commission is PAID', async () => {
      repository.findById.mockResolvedValue(PAID_COMMISSION);

      await expect(service.cancel('comm-2', 'owner-1', Role.OWNER)).rejects.toThrow(ConflictException);
    });

    it('throws 403 when not the property owner', async () => {
      repository.findById.mockResolvedValue(PENDING_COMMISSION);

      await expect(service.cancel('comm-1', 'other-user', Role.OWNER)).rejects.toThrow(ForbiddenException);
    });

    it('throws 404 when commission not found', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.cancel('missing', 'owner-1', Role.OWNER)).rejects.toThrow(NotFoundException);
    });
  });

  // ── Story 8.5: list + dashboard ───────────────────────────────────────────

  describe('list (Story 8.5)', () => {
    const PAGINATED = {
      data: [PENDING_COMMISSION],
      meta: { total: 1, pageNumber: 0, pageSize: 10, totalPages: 1 },
    };

    it('delegates to repository with role-scoped where clause', async () => {
      prisma.agencyMember.findMany.mockResolvedValue([{ agencyId: 'agency-1' }]);
      repository.findPaginated.mockResolvedValue(PAGINATED);

      const result = await service.list('manager-1', Role.MANAGER, {});

      expect(result).toEqual(PAGINATED);
      expect(repository.findPaginated).toHaveBeenCalledWith(
        expect.objectContaining({ agencyId: { in: ['agency-1'] } }),
        1,
        10,
      );
    });
  });

  describe('getDashboard (Story 8.5)', () => {
    const STATS = {
      byStatus: [{ status: 'PENDING', _count: { id: 2 }, _sum: { amountHT: 200000, amountTTC: 238500 } }],
      byType: [{ type: 'MANAGEMENT', _count: { id: 2 }, _sum: { amountTTC: 238500 } }],
    };

    it('returns dashboard stats for MANAGER scoped to their agency', async () => {
      prisma.agencyMember.findFirst.mockResolvedValue({ agencyId: 'agency-1' });
      repository.getDashboardStats.mockResolvedValue(STATS);

      const result = await service.getDashboard('manager-1', Role.MANAGER);

      expect(result).toEqual(STATS);
      expect(repository.getDashboardStats).toHaveBeenCalledWith('agency-1');
    });

    it('returns cached data on second call', async () => {
      cache.get.mockResolvedValue(STATS);

      const result = await service.getDashboard('admin-1', Role.ADMIN);

      expect(result).toEqual(STATS);
      expect(repository.getDashboardStats).not.toHaveBeenCalled();
    });

    it('ADMIN passes null agencyId to repository', async () => {
      repository.getDashboardStats.mockResolvedValue(STATS);

      await service.getDashboard('admin-1', Role.ADMIN);

      expect(repository.getDashboardStats).toHaveBeenCalledWith(null);
    });

    it('MANAGER with no membership returns empty dashboard', async () => {
      prisma.agencyMember.findFirst.mockResolvedValue(null);

      const result = await service.getDashboard('manager-x', Role.MANAGER);

      expect(result).toEqual({ byStatus: [], byType: [] });
      expect(repository.getDashboardStats).not.toHaveBeenCalled();
    });
  });

  // ── Story 8.6: getMyDue ───────────────────────────────────────────────────

  describe('getMyDue (Story 8.6)', () => {
    it('groups commissions by agency with subtotals', async () => {
      repository.getOwnerDue.mockResolvedValue([
        { ...PENDING_COMMISSION, status: CommissionStatus.PENDING, amountTTC: 119250, agency: { id: 'agency-1', name: 'SARL Immobil' } },
        { ...PENDING_COMMISSION, id: 'comm-3', status: CommissionStatus.PAID, amountTTC: 119250, agency: { id: 'agency-1', name: 'SARL Immobil' } },
      ]);

      const result = (await service.getMyDue('owner-1')) as { data: { agencyName: string; pendingCount: number; paidCount: number; pendingAmountTTC: number; paidAmountTTC: number }[] };

      expect(result.data).toHaveLength(1);
      expect(result.data[0].agencyName).toBe('SARL Immobil');
      expect(result.data[0].pendingCount).toBe(1);
      expect(result.data[0].paidCount).toBe(1);
      expect(result.data[0].pendingAmountTTC).toBe(119250);
      expect(result.data[0].paidAmountTTC).toBe(119250);
    });

    it('returns empty data when owner has no commissions', async () => {
      repository.getOwnerDue.mockResolvedValue([]);

      const result = (await service.getMyDue('owner-x')) as { data: unknown[] };

      expect(result.data).toHaveLength(0);
    });

    it('groups by agency when multiple agencies exist', async () => {
      repository.getOwnerDue.mockResolvedValue([
        { ...PENDING_COMMISSION, agencyId: 'agency-1', status: CommissionStatus.PENDING, amountTTC: 50000, agency: { id: 'agency-1', name: 'Agency A' } },
        { ...PENDING_COMMISSION, id: 'comm-4', agencyId: 'agency-2', status: CommissionStatus.PAID, amountTTC: 75000, agency: { id: 'agency-2', name: 'Agency B' } },
      ]);

      const result = (await service.getMyDue('owner-1')) as { data: { agencyId: string }[] };

      expect(result.data).toHaveLength(2);
      const ids = result.data.map((g) => g.agencyId).sort();
      expect(ids).toEqual(['agency-1', 'agency-2']);
    });
  });
});
