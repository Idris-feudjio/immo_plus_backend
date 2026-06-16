import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AgencyMemberRole, AgencyStatus, MandateStatus, Prisma, Role } from '@prisma/client';
import { AgenciesService } from './agencies.service';

// ─── Mock factories ───────────────────────────────────────────────────────────

function mockPrisma() {
  return {
    agency: {
      findUnique: jest.fn(),
    },
    agencyMember: {
      findFirst: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    mandate: {
      count: jest.fn().mockResolvedValue(0),
    },
  };
}

function mockRepository() {
  return {
    create: jest.fn(),
    update: jest.fn(),
    findByIdOrThrow: jest.fn(),
    findWithPagination: jest.fn(),
  };
}

function mockCache() {
  return {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    del: jest.fn().mockResolvedValue(undefined),
  };
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const AGENCY_STUB = {
  id: 'agency-1',
  name: 'Immo Pro',
  email: 'agency@immo.cm',
  phone: '+237600000000',
  address: 'Bonanjo, Douala',
  rccm: 'DLA/2024/001',
  status: AgencyStatus.ACTIVE,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

const MEMBER_STUB = {
  id: 'member-1',
  agencyId: 'agency-1',
  userId: 'user-manager-1',
  role: AgencyMemberRole.MEMBER,
  joinedAt: new Date('2026-01-01'),
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AgenciesService', () => {
  let service: AgenciesService;
  let prisma: ReturnType<typeof mockPrisma>;
  let repository: ReturnType<typeof mockRepository>;
  let cache: ReturnType<typeof mockCache>;

  beforeEach(() => {
    prisma = mockPrisma();
    repository = mockRepository();
    cache = mockCache();
    service = new AgenciesService(repository as never, prisma as never, cache as never);
  });

  // ── createAgency ───────────────────────────────────────────────────────────

  describe('createAgency', () => {
    it('creates agency with ACTIVE status', async () => {
      repository.create.mockResolvedValue(AGENCY_STUB);

      const result = await service.createAgency({
        name: 'Immo Pro',
        email: 'agency@immo.cm',
        phone: '+237600000000',
      });

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: AgencyStatus.ACTIVE }),
      );
      expect(result).toEqual(AGENCY_STUB);
    });
  });

  // ── suspend ────────────────────────────────────────────────────────────────

  describe('suspend', () => {
    it('suspends an existing agency', async () => {
      prisma.agency.findUnique.mockResolvedValue({ id: 'agency-1' });
      const suspended = { ...AGENCY_STUB, status: AgencyStatus.SUSPENDED };
      repository.findByIdOrThrow.mockResolvedValue(AGENCY_STUB);
      repository.update.mockResolvedValue(suspended);

      const result = await service.suspend('agency-1');

      expect(repository.update).toHaveBeenCalledWith('agency-1', { status: AgencyStatus.SUSPENDED });
      expect(result.status).toBe(AgencyStatus.SUSPENDED);
    });

    it('throws NotFoundException when agency does not exist', async () => {
      prisma.agency.findUnique.mockResolvedValue(null);

      await expect(service.suspend('unknown')).rejects.toThrow(NotFoundException);
    });
  });

  // ── search ─────────────────────────────────────────────────────────────────

  describe('search', () => {
    it('returns paginated agencies with member count', async () => {
      const agencyWithCount = { ...AGENCY_STUB, _count: { members: 2 } };
      repository.findWithPagination.mockResolvedValue({
        data: [agencyWithCount],
        meta: { total: 1, pageSize: 10, pageNumber: 0, totalPages: 1 },
      });

      const result = await service.search({ pageNumber: 0, pageSize: 10 });

      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
      expect(repository.findWithPagination).toHaveBeenCalledWith({ pageNumber: 0, pageSize: 10 }, {});
    });

    it('delegates to repository with empty baseWhere', async () => {
      repository.findWithPagination.mockResolvedValue({
        data: [],
        meta: { total: 0, pageSize: 20, pageNumber: 0, totalPages: 0 },
      });

      await service.search({});

      expect(repository.findWithPagination).toHaveBeenCalledWith({}, {});
    });
  });

  // ── addMember ──────────────────────────────────────────────────────────────

  describe('addMember', () => {
    beforeEach(() => {
      prisma.agency.findUnique.mockResolvedValue({ id: 'agency-1' });
      prisma.user.findUnique.mockResolvedValue({ id: 'user-manager-1', role: Role.MANAGER });
      prisma.agencyMember.create.mockResolvedValue(MEMBER_STUB);
    });

    it('allows ADMIN to add member without membership check', async () => {
      const result = await service.addMember('agency-1', 'admin-user-1', Role.ADMIN, {
        userId: 'user-manager-1',
      });

      expect(prisma.agencyMember.findFirst).not.toHaveBeenCalled();
      expect(result).toEqual(MEMBER_STUB);
    });

    it('allows agency ADMIN member to add new member', async () => {
      prisma.agencyMember.findFirst.mockResolvedValue({ id: 'admin-member-1' });

      const result = await service.addMember('agency-1', 'agency-admin-user', Role.OWNER, {
        userId: 'user-manager-1',
      });

      expect(result).toEqual(MEMBER_STUB);
    });

    it('throws ForbiddenException when non-admin non-agency-admin tries to add', async () => {
      prisma.agencyMember.findFirst.mockResolvedValue(null);

      await expect(
        service.addMember('agency-1', 'random-user', Role.OWNER, { userId: 'user-manager-1' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws UnprocessableEntityException when user is not MANAGER', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-owner-1', role: Role.OWNER });

      await expect(
        service.addMember('agency-1', 'admin-user-1', Role.ADMIN, { userId: 'user-owner-1' }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('throws NotFoundException when user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.addMember('agency-1', 'admin-user-1', Role.ADMIN, { userId: 'unknown-user' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when user already in agency (P2002)', async () => {
      const prismaError = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.0.0',
      });
      prisma.agencyMember.create.mockRejectedValue(prismaError);

      await expect(
        service.addMember('agency-1', 'admin-user-1', Role.ADMIN, { userId: 'user-manager-1' }),
      ).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException when agency does not exist', async () => {
      prisma.agency.findUnique.mockResolvedValue(null);

      await expect(
        service.addMember('unknown-agency', 'admin-user-1', Role.ADMIN, { userId: 'user-manager-1' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── removeMember ───────────────────────────────────────────────────────────

  describe('removeMember', () => {
    it('deletes an existing member', async () => {
      prisma.agencyMember.findFirst.mockResolvedValue({ id: 'member-1' });
      prisma.agencyMember.delete.mockResolvedValue(MEMBER_STUB);

      await service.removeMember('agency-1', 'member-1');

      expect(prisma.agencyMember.delete).toHaveBeenCalledWith({ where: { id: 'member-1' } });
    });

    it('throws NotFoundException when member not found in agency', async () => {
      prisma.agencyMember.findFirst.mockResolvedValue(null);

      await expect(service.removeMember('agency-1', 'nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  // ── getPublicProfile ───────────────────────────────────────────────────────

  describe('getPublicProfile', () => {
    it('returns profile with managedPropertiesCount from DB when cache miss', async () => {
      prisma.agency.findUnique.mockResolvedValue({
        id: 'agency-1',
        name: 'Immo Pro',
        address: 'Bonanjo',
        phone: '+237600000000',
        email: 'agency@immo.cm',
      });
      prisma.mandate.count.mockResolvedValue(5);

      const result = await service.getPublicProfile('agency-1');

      expect(result.managedPropertiesCount).toBe(5);
      expect(result.id).toBe('agency-1');
      expect(cache.set).toHaveBeenCalledWith('agency:agency-1:profile', expect.any(Object), 1800);
    });

    it('returns cached profile without hitting DB', async () => {
      const cachedProfile = {
        id: 'agency-1',
        name: 'Immo Pro',
        address: 'Bonanjo',
        phone: '+237600000000',
        email: 'agency@immo.cm',
        managedPropertiesCount: 3,
      };
      cache.get.mockResolvedValue(cachedProfile);

      const result = await service.getPublicProfile('agency-1');

      expect(result).toEqual(cachedProfile);
      expect(prisma.agency.findUnique).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when agency not found', async () => {
      prisma.agency.findUnique.mockResolvedValue(null);

      await expect(service.getPublicProfile('unknown')).rejects.toThrow(NotFoundException);
    });

    it('counts only ACTIVE mandates with published properties', async () => {
      prisma.agency.findUnique.mockResolvedValue({
        id: 'agency-1',
        name: 'Test',
        address: null,
        phone: '+237600000000',
        email: 'test@test.cm',
      });
      prisma.mandate.count.mockResolvedValue(2);

      await service.getPublicProfile('agency-1');

      expect(prisma.mandate.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            agencyId: 'agency-1',
            status: MandateStatus.ACTIVE,
            property: { isPublished: true },
          }),
        }),
      );
    });
  });
});
