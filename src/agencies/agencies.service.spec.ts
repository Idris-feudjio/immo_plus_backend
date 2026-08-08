import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  AgencyMemberRole,
  AgencyStatus,
  MandateStatus,
  Prisma,
  Role,
} from '@prisma/client';
import { AgenciesService } from './agencies.service';

// ─── Mock factories ───────────────────────────────────────────────────────────

function mockPrisma() {
  const tx = {
    agency: { create: jest.fn() },
    agencyMember: { findFirst: jest.fn(), create: jest.fn() },
    plan: { findUnique: jest.fn().mockResolvedValue(null) },
    subscription: { create: jest.fn() },
    trial: { create: jest.fn() },
  };
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
    $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(tx)),
    _tx: tx,
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

function mockMandateRepo() {
  return { findActiveByAgency: jest.fn().mockResolvedValue([]) };
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

const MANAGER_USER = {
  id: 'user-manager-1',
  email: 'manager@test.cm',
  role: Role.MANAGER,
  firstName: 'Sara',
  lastName: 'Eba',
  isActive: true,
  avatarUrl: null,
};
const ADMIN_USER = {
  id: 'admin-1',
  email: 'admin@test.cm',
  role: Role.ADMIN,
  firstName: 'Admin',
  lastName: 'A',
  isActive: true,
  avatarUrl: null,
};

const CREATE_AGENCY_DTO = {
  name: 'Immo Pro',
  email: 'agency@immo.cm',
  phone: '+237600000000',
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AgenciesService', () => {
  let service: AgenciesService;
  let prisma: ReturnType<typeof mockPrisma>;
  let repository: ReturnType<typeof mockRepository>;
  let cache: ReturnType<typeof mockCache>;
  let mandateRepo: ReturnType<typeof mockMandateRepo>;

  beforeEach(() => {
    prisma = mockPrisma();
    repository = mockRepository();
    cache = mockCache();
    mandateRepo = mockMandateRepo();
    service = new AgenciesService(
      repository as never,
      prisma as never,
      cache as never,
      mandateRepo as never,
    );
  });

  // ── createAgency ───────────────────────────────────────────────────────────

  describe('createAgency', () => {
    beforeEach(() => {
      prisma._tx.agencyMember.findFirst.mockResolvedValue(null);
      prisma._tx.agency.create.mockResolvedValue(AGENCY_STUB);
      prisma._tx.agencyMember.create.mockResolvedValue(MEMBER_STUB);
    });

    it('creates agency with ACTIVE status', async () => {
      const result = await service.createAgency(
        MANAGER_USER,
        CREATE_AGENCY_DTO,
      );

      expect(prisma._tx.agency.create).toHaveBeenCalledWith({
        data: {
          name: 'Immo Pro',
          email: 'agency@immo.cm',
          phone: '+237600000000',
          address: undefined,
          rccm: undefined,
          status: AgencyStatus.ACTIVE,
        },
      });
      expect(result).toEqual(AGENCY_STUB);
    });

    it('creates an ADMIN AgencyMember row for the creating MANAGER, atomically', async () => {
      await service.createAgency(MANAGER_USER, CREATE_AGENCY_DTO);

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma._tx.agencyMember.create).toHaveBeenCalledWith({
        data: {
          agencyId: 'agency-1',
          userId: 'user-manager-1',
          role: AgencyMemberRole.ADMIN,
        },
      });
    });

    it('does NOT create a membership when the creator is ADMIN', async () => {
      await service.createAgency(ADMIN_USER, CREATE_AGENCY_DTO);

      expect(prisma._tx.agencyMember.create).not.toHaveBeenCalled();
    });

    it('throws ConflictException (409) when the MANAGER already belongs to an agency (checked inside the transaction)', async () => {
      prisma._tx.agencyMember.findFirst.mockResolvedValue({
        id: 'existing-member',
      });

      await expect(
        service.createAgency(MANAGER_USER as never, CREATE_AGENCY_DTO),
      ).rejects.toThrow(ConflictException);
      expect(prisma._tx.agency.create).not.toHaveBeenCalled();
    });

    it('does not check membership for an ADMIN creator', async () => {
      await service.createAgency(ADMIN_USER, CREATE_AGENCY_DTO);

      expect(prisma._tx.agencyMember.findFirst).not.toHaveBeenCalled();
    });

    it('uses a Serializable transaction to close the anti-doublon race', async () => {
      await service.createAgency(MANAGER_USER, CREATE_AGENCY_DTO);

      expect(prisma.$transaction).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ isolationLevel: 'Serializable' }),
      );
    });

    describe('free trial activation (story 2.1)', () => {
      beforeEach(() => {
        prisma._tx.plan.findUnique.mockResolvedValue({ id: 'plan-pro' });
        prisma._tx.subscription.create.mockResolvedValue({
          id: 'sub-agency-1',
        });
      });

      it('creates a TRIAL Subscription + Trial (14 days) for the new agency, in the same transaction', async () => {
        await service.createAgency(MANAGER_USER, CREATE_AGENCY_DTO);

        expect(prisma._tx.plan.findUnique).toHaveBeenCalledWith({
          where: { name: 'PROFESSIONAL' },
        });
        expect(prisma._tx.subscription.create).toHaveBeenCalledWith({
          data: { agencyId: 'agency-1', planId: 'plan-pro', status: 'TRIAL' },
        });
        expect(prisma._tx.trial.create).toHaveBeenCalledWith({
          data: { subscriptionId: 'sub-agency-1', endsAt: expect.any(Date) },
        });
      });

      it('rolls back the agency creation if the Subscription write fails (same transaction)', async () => {
        prisma._tx.subscription.create.mockRejectedValue(new Error('db error'));

        await expect(
          service.createAgency(MANAGER_USER, CREATE_AGENCY_DTO),
        ).rejects.toThrow('db error');
        // The transaction callback throwing means Prisma would roll back everything,
        // including the agency.create call already issued earlier in the same callback.
        expect(prisma.$transaction).toHaveBeenCalled();
      });

      it('does not fail agency creation when the Professional plan is missing (fail-open)', async () => {
        prisma._tx.plan.findUnique.mockResolvedValue(null);

        const result = await service.createAgency(
          MANAGER_USER,
          CREATE_AGENCY_DTO,
        );

        expect(result).toEqual(AGENCY_STUB);
        expect(prisma._tx.subscription.create).not.toHaveBeenCalled();
      });
    });

    it('throws ConflictException("AGENCY_EMAIL_ALREADY_EXISTS") when the P2002 conflict targets the agency email', async () => {
      const prismaError = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        { code: 'P2002', clientVersion: '5.0.0', meta: { target: ['email'] } },
      );
      prisma._tx.agency.create.mockRejectedValue(prismaError);

      await expect(
        service.createAgency(MANAGER_USER as never, CREATE_AGENCY_DTO),
      ).rejects.toThrow('Cet email est déjà utilisé par une autre agence');
    });

    it('throws ConflictException("AGENCY_ALREADY_EXISTS") when the P2002 conflict targets AgencyMember.userId (race)', async () => {
      const prismaError = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        {
          code: 'P2002',
          clientVersion: '5.0.0',
          meta: { target: ['userId'] },
        },
      );
      prisma._tx.agencyMember.create.mockRejectedValue(prismaError);

      await expect(
        service.createAgency(MANAGER_USER as never, CREATE_AGENCY_DTO),
      ).rejects.toThrow('Une agence avec ce nom existe déjà');
    });
  });

  // ── getMyAgency ────────────────────────────────────────────────────────────

  describe('getMyAgency', () => {
    it('returns the agency and its active mandates', async () => {
      prisma.agencyMember.findFirst.mockResolvedValue({
        id: 'member-1',
        agencyId: 'agency-1',
        agency: AGENCY_STUB,
      });
      const mandates = [{ id: 'mandate-1', status: MandateStatus.ACTIVE }];
      mandateRepo.findActiveByAgency.mockResolvedValue(mandates);

      const result = await service.getMyAgency('user-manager-1');

      expect(result).toEqual({ agency: AGENCY_STUB, mandates });
      expect(mandateRepo.findActiveByAgency).toHaveBeenCalledWith('agency-1');
    });

    it('throws NotFoundException when the user has no agency', async () => {
      prisma.agencyMember.findFirst.mockResolvedValue(null);

      await expect(service.getMyAgency('user-manager-1')).rejects.toThrow(
        'NO_AGENCY',
      );
      expect(mandateRepo.findActiveByAgency).not.toHaveBeenCalled();
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

      expect(repository.update).toHaveBeenCalledWith('agency-1', {
        status: AgencyStatus.SUSPENDED,
      });
      expect(result.status).toBe(AgencyStatus.SUSPENDED);
    });

    it('throws NotFoundException when agency does not exist', async () => {
      prisma.agency.findUnique.mockResolvedValue(null);

      await expect(service.suspend('unknown')).rejects.toThrow(
        NotFoundException,
      );
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
      expect(repository.findWithPagination).toHaveBeenCalledWith(
        { pageNumber: 0, pageSize: 10 },
        {},
      );
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
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-manager-1',
        role: Role.MANAGER,
      });
      prisma.agencyMember.create.mockResolvedValue(MEMBER_STUB);
    });

    it('allows ADMIN to add member without membership check', async () => {
      const result = await service.addMember(
        'agency-1',
        'admin-user-1',
        Role.ADMIN,
        {
          userId: 'user-manager-1',
        },
      );

      expect(prisma.agencyMember.findFirst).not.toHaveBeenCalled();
      expect(result).toEqual(MEMBER_STUB);
    });

    it('allows agency ADMIN member to add new member', async () => {
      prisma.agencyMember.findFirst.mockResolvedValue({ id: 'admin-member-1' });

      const result = await service.addMember(
        'agency-1',
        'agency-admin-user',
        Role.OWNER,
        {
          userId: 'user-manager-1',
        },
      );

      expect(result).toEqual(MEMBER_STUB);
    });

    it('throws ForbiddenException when non-admin non-agency-admin tries to add', async () => {
      prisma.agencyMember.findFirst.mockResolvedValue(null);

      await expect(
        service.addMember('agency-1', 'random-user', Role.OWNER, {
          userId: 'user-manager-1',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws UnprocessableEntityException when user is not MANAGER', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-owner-1',
        role: Role.OWNER,
      });

      await expect(
        service.addMember('agency-1', 'admin-user-1', Role.ADMIN, {
          userId: 'user-owner-1',
        }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('throws NotFoundException when user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.addMember('agency-1', 'admin-user-1', Role.ADMIN, {
          userId: 'unknown-user',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when user already in agency (P2002)', async () => {
      const prismaError = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        {
          code: 'P2002',
          clientVersion: '5.0.0',
        },
      );
      prisma.agencyMember.create.mockRejectedValue(prismaError);

      await expect(
        service.addMember('agency-1', 'admin-user-1', Role.ADMIN, {
          userId: 'user-manager-1',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException when agency does not exist', async () => {
      prisma.agency.findUnique.mockResolvedValue(null);

      await expect(
        service.addMember('unknown-agency', 'admin-user-1', Role.ADMIN, {
          userId: 'user-manager-1',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── removeMember ───────────────────────────────────────────────────────────

  describe('removeMember', () => {
    it('deletes an existing member', async () => {
      prisma.agencyMember.findFirst.mockResolvedValue({ id: 'member-1' });
      prisma.agencyMember.delete.mockResolvedValue(MEMBER_STUB);

      await service.removeMember('agency-1', 'member-1');

      expect(prisma.agencyMember.delete).toHaveBeenCalledWith({
        where: { id: 'member-1' },
      });
    });

    it('throws NotFoundException when member not found in agency', async () => {
      prisma.agencyMember.findFirst.mockResolvedValue(null);

      await expect(
        service.removeMember('agency-1', 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
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
      expect(cache.set).toHaveBeenCalledWith(
        'agency:agency-1:profile',
        expect.any(Object),
        1800,
      );
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

      await expect(service.getPublicProfile('unknown')).rejects.toThrow(
        NotFoundException,
      );
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
          where: {
            agencyId: 'agency-1',
            status: MandateStatus.ACTIVE,
            deletedAt: null,
            property: { isPublished: true },
          },
        }),
      );
    });
  });
});
