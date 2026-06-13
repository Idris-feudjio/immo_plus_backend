import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { MandateStatus, Role } from '@prisma/client';
import { MandatesService } from './mandates.service';

// ─── Mock factories ───────────────────────────────────────────────────────────

function mockRepository() {
  return {
    findById: jest.fn(),
    create: jest.fn(),
    updateStatus: jest.fn(),
    findDuplicate: jest.fn().mockResolvedValue(null),
    findListPaginated: jest.fn(),
    findActiveByManager: jest.fn(),
  };
}

function mockPrisma() {
  return {
    property: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    agencyMember: {
      findFirst: jest.fn(),
    },
  };
}

function mockNotificationRepo() {
  return {
    create: jest.fn().mockResolvedValue({}),
  };
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MANDATE_STUB = {
  id: 'mandate-1',
  propertyId: 'property-1',
  agencyId: 'agency-1',
  managerId: 'manager-1',
  status: MandateStatus.ACTIVE,
  startDate: new Date('2026-01-01'),
  endDate: null,
  commissionType: null,
  commissionValue: null,
  description: null,
  deletedAt: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

const PROPERTY_STUB = {
  id: 'property-1',
  ownerId: 'owner-1',
  title: 'Villa Bastos',
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('MandatesService', () => {
  let service: MandatesService;
  let repository: ReturnType<typeof mockRepository>;
  let prisma: ReturnType<typeof mockPrisma>;
  let notificationRepo: ReturnType<typeof mockNotificationRepo>;

  beforeEach(() => {
    repository = mockRepository();
    prisma = mockPrisma();
    notificationRepo = mockNotificationRepo();
    service = new MandatesService(repository as never, prisma as never, notificationRepo as never);
  });

  // ── create ────────────────────────────────────────────────────────────────

  describe('create', () => {
    const CREATE_DTO = {
      propertyId: 'property-1',
      agencyId: 'agency-1',
      managerId: 'manager-1',
      startDate: '2026-01-01',
    };

    beforeEach(() => {
      prisma.property.findUnique.mockResolvedValue(PROPERTY_STUB);
      prisma.agencyMember.findFirst.mockResolvedValue({ id: 'membership-1' });
      repository.create.mockResolvedValue(MANDATE_STUB);
    });

    it('creates mandate with ACTIVE status for OWNER of property', async () => {
      const result = await service.create('owner-1', Role.OWNER, CREATE_DTO);

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: MandateStatus.ACTIVE }),
      );
      expect(result).toEqual(MANDATE_STUB);
    });

    it('allows ADMIN to create mandate regardless of ownership', async () => {
      const result = await service.create('admin-1', Role.ADMIN, CREATE_DTO);

      expect(result).toEqual(MANDATE_STUB);
    });

    it('throws NotFoundException when property does not exist', async () => {
      prisma.property.findUnique.mockResolvedValue(null);

      await expect(service.create('owner-1', Role.OWNER, CREATE_DTO)).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when non-owner tries to create', async () => {
      await expect(service.create('other-user', Role.OWNER, CREATE_DTO)).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when manager is not in agency', async () => {
      prisma.agencyMember.findFirst.mockResolvedValue(null);

      await expect(service.create('owner-1', Role.OWNER, CREATE_DTO)).rejects.toThrow(ForbiddenException);
    });

    it('throws ConflictException when duplicate active mandate exists', async () => {
      repository.findDuplicate.mockResolvedValue({ id: 'existing-mandate' });

      await expect(service.create('owner-1', Role.OWNER, CREATE_DTO)).rejects.toThrow(ConflictException);
    });

    it('syncs Property.managerId after mandate creation', async () => {
      await service.create('owner-1', Role.OWNER, CREATE_DTO);

      expect(prisma.property.update).toHaveBeenCalledWith({
        where: { id: 'property-1' },
        data: { managerId: 'manager-1' },
      });
    });

    it('sends in-app notification to manager after creation', async () => {
      await service.create('owner-1', Role.OWNER, CREATE_DTO);

      expect(notificationRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'manager-1',
          type: 'mandate_assigned',
        }),
      );
    });
  });

  // ── terminate ─────────────────────────────────────────────────────────────

  describe('terminate', () => {
    beforeEach(() => {
      repository.findById.mockResolvedValue(MANDATE_STUB);
      prisma.property.findUnique.mockResolvedValue(PROPERTY_STUB);
      repository.updateStatus.mockResolvedValue({ ...MANDATE_STUB, status: MandateStatus.TERMINATED });
    });

    it('terminates an ACTIVE mandate for OWNER', async () => {
      const result = await service.terminate('mandate-1', 'owner-1', Role.OWNER, {});

      expect(repository.updateStatus).toHaveBeenCalledWith('mandate-1', MandateStatus.TERMINATED);
      expect(result.status).toBe(MandateStatus.TERMINATED);
    });

    it('allows ADMIN to terminate any mandate', async () => {
      const result = await service.terminate('mandate-1', 'admin-1', Role.ADMIN, {});

      expect(result.status).toBe(MandateStatus.TERMINATED);
    });

    it('throws NotFoundException when mandate not found', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.terminate('unknown', 'owner-1', Role.OWNER, {})).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when non-owner tries to terminate', async () => {
      await expect(service.terminate('mandate-1', 'other-user', Role.OWNER, {})).rejects.toThrow(ForbiddenException);
    });

    it('throws ConflictException when mandate is already TERMINATED', async () => {
      repository.findById.mockResolvedValue({ ...MANDATE_STUB, status: MandateStatus.TERMINATED });

      await expect(service.terminate('mandate-1', 'owner-1', Role.OWNER, {})).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException when mandate is already EXPIRED', async () => {
      repository.findById.mockResolvedValue({ ...MANDATE_STUB, status: MandateStatus.EXPIRED });

      await expect(service.terminate('mandate-1', 'owner-1', Role.OWNER, {})).rejects.toThrow(ConflictException);
    });

    it('clears Property.managerId after termination when it matches', async () => {
      await service.terminate('mandate-1', 'owner-1', Role.OWNER, {});

      expect(prisma.property.updateMany).toHaveBeenCalledWith({
        where: { id: 'property-1', managerId: 'manager-1' },
        data: { managerId: null },
      });
    });

    it('sends in-app notification to manager after termination', async () => {
      await service.terminate('mandate-1', 'owner-1', Role.OWNER, {});

      expect(notificationRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'manager-1',
          type: 'mandate_terminated',
        }),
      );
    });
  });

  // ── list ──────────────────────────────────────────────────────────────────

  describe('list', () => {
    it('delegates to repository.findListPaginated', async () => {
      const mockResult = { data: [MANDATE_STUB], meta: { total: 1, pageNumber: 0, pageSize: 10, totalPages: 1 } };
      repository.findListPaginated.mockResolvedValue(mockResult);

      const result = await service.list('user-1', Role.MANAGER, { page: 1 });

      expect(repository.findListPaginated).toHaveBeenCalledWith('user-1', Role.MANAGER, { page: 1 });
      expect(result).toEqual(mockResult);
    });
  });
});
