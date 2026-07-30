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
    findWithPagination: jest.fn(),
    findActiveByManager: jest.fn(),
  };
}

function mockTx() {
  return {
    mandate: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      update: jest.fn(),
    },
    property: {
      update: jest.fn().mockResolvedValue({}),
    },
  };
}

function mockPrisma() {
  const tx = mockTx();
  return {
    property: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    agencyMember: {
      findFirst: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn((cb: (tx: ReturnType<typeof mockTx>) => unknown) =>
      cb(tx),
    ),
    tx,
  };
}

function mockNotificationRepo() {
  return {
    create: jest.fn().mockResolvedValue({}),
  };
}

function mockEmailQueue() {
  return {
    sendEmail: jest.fn().mockResolvedValue(undefined),
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

const MANAGER_STUB = {
  id: 'manager-1',
  email: 'manager@test.cm',
  firstName: 'Paul',
  lastName: 'Biya',
  role: Role.MANAGER,
  isActive: true,
};

const OWNER_STUB = {
  id: 'owner-1',
  email: 'owner@test.cm',
  firstName: 'Jean',
  lastName: 'Mballa',
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('MandatesService', () => {
  let service: MandatesService;
  let repository: ReturnType<typeof mockRepository>;
  let prisma: ReturnType<typeof mockPrisma>;
  let notificationRepo: ReturnType<typeof mockNotificationRepo>;
  let emailQueue: ReturnType<typeof mockEmailQueue>;

  beforeEach(() => {
    repository = mockRepository();
    prisma = mockPrisma();
    notificationRepo = mockNotificationRepo();
    emailQueue = mockEmailQueue();
    service = new MandatesService(
      repository as never,
      prisma as never,
      notificationRepo as never,
      emailQueue as never,
    );
  });

  // ── create ────────────────────────────────────────────────────────────────

  describe('create', () => {
    const CREATE_DTO = {
      propertyId: 'property-1',
      managerEmail: 'manager@test.cm',
      startDate: '2026-01-01',
    };

    beforeEach(() => {
      prisma.property.findUnique.mockResolvedValue(PROPERTY_STUB);
      prisma.user.findUnique.mockResolvedValue(MANAGER_STUB);
      prisma.agencyMember.findFirst.mockResolvedValue({ agencyId: 'agency-1' });
      prisma.tx.mandate.findFirst.mockResolvedValue(null);
      prisma.tx.mandate.create.mockResolvedValue(MANDATE_STUB);
    });

    it('creates mandate with PENDING status for OWNER of property, inside a Serializable transaction', async () => {
      const result = await service.createMandate(
        'owner-1',
        Role.OWNER,
        CREATE_DTO,
      );

      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: 'Serializable',
      });
      const [createArg] = prisma.tx.mandate.create.mock.calls[0] as [
        {
          data: { status: MandateStatus; agencyId: string; managerId: string };
        },
      ];
      expect(createArg.data).toEqual(
        expect.objectContaining({
          status: MandateStatus.PENDING,
          agencyId: 'agency-1',
          managerId: 'manager-1',
        }),
      );
      expect(result).toEqual(MANDATE_STUB);
    });

    it('resolves the manager by email (lowercased) and looks up their agency membership', async () => {
      await service.createMandate('owner-1', Role.OWNER, {
        ...CREATE_DTO,
        managerEmail: 'Manager@Test.CM',
      });

      expect(prisma.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { email: 'manager@test.cm' } }),
      );
      expect(prisma.agencyMember.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'manager-1' } }),
      );
    });

    it('allows ADMIN to create mandate regardless of ownership', async () => {
      const result = await service.createMandate(
        'admin-1',
        Role.ADMIN,
        CREATE_DTO,
      );

      expect(result).toEqual(MANDATE_STUB);
    });

    it('throws NotFoundException when property does not exist', async () => {
      prisma.property.findUnique.mockResolvedValue(null);

      await expect(
        service.createMandate('owner-1', Role.OWNER, CREATE_DTO),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when non-owner tries to create', async () => {
      await expect(
        service.createMandate('other-user', Role.OWNER, CREATE_DTO),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException("MANAGER_NOT_FOUND") when no user matches the email', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.createMandate('owner-1', Role.OWNER, CREATE_DTO),
      ).rejects.toThrow('Aucun gestionnaire trouvé avec cet email');
      expect(prisma.tx.mandate.create).not.toHaveBeenCalled();
    });

    it('throws NotFoundException("MANAGER_NOT_FOUND") when the matched user is not a MANAGER', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...MANAGER_STUB,
        role: Role.OWNER,
      });

      await expect(
        service.createMandate('owner-1', Role.OWNER, CREATE_DTO),
      ).rejects.toThrow('Aucun gestionnaire trouvé avec cet email');
    });

    it('throws NotFoundException("MANAGER_NOT_FOUND") when the matched manager account is deactivated', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...MANAGER_STUB,
        isActive: false,
      });

      await expect(
        service.createMandate('owner-1', Role.OWNER, CREATE_DTO),
      ).rejects.toThrow('Aucun gestionnaire trouvé avec cet email');
    });

    it('throws ForbiddenException("MANAGER_NOT_IN_AGENCY") when manager is not in an agency', async () => {
      prisma.agencyMember.findFirst.mockResolvedValue(null);

      await expect(
        service.createMandate('owner-1', Role.OWNER, CREATE_DTO),
      ).rejects.toThrow("Ce gestionnaire n'appartient à aucune agence");
    });

    it('throws ConflictException when a PENDING or ACTIVE mandate already exists (checked inside the transaction)', async () => {
      prisma.tx.mandate.findFirst.mockResolvedValue({ id: 'existing-mandate' });

      await expect(
        service.createMandate('owner-1', Role.OWNER, CREATE_DTO),
      ).rejects.toThrow('Ce gestionnaire a déjà un mandat actif sur ce bien');
      expect(prisma.tx.mandate.create).not.toHaveBeenCalled();
    });

    it('does NOT assign Property.managerId at invitation time', async () => {
      await service.createMandate('owner-1', Role.OWNER, CREATE_DTO);

      expect(prisma.property.update).not.toHaveBeenCalled();
    });

    it('sends in-app notification to manager after creation', async () => {
      await service.createMandate('owner-1', Role.OWNER, CREATE_DTO);

      expect(notificationRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'manager-1',
          type: 'mandate_invitation',
        }),
      );
    });

    it('sends an invitation email to the manager', async () => {
      await service.createMandate('owner-1', Role.OWNER, CREATE_DTO);

      expect(emailQueue.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'manager@test.cm',
          template: 'mandate-invitation',
        }),
      );
    });

    it('does not fail the request when notification/email dispatch throws', async () => {
      emailQueue.sendEmail.mockRejectedValueOnce(new Error('SES down'));

      const result = await service.createMandate(
        'owner-1',
        Role.OWNER,
        CREATE_DTO,
      );

      expect(result).toEqual(MANDATE_STUB);
    });
  });

  // ── terminate ─────────────────────────────────────────────────────────────

  describe('terminate', () => {
    beforeEach(() => {
      repository.findById.mockResolvedValue(MANDATE_STUB);
      prisma.property.findUnique.mockResolvedValue(PROPERTY_STUB);
      repository.updateStatus.mockResolvedValue({
        ...MANDATE_STUB,
        status: MandateStatus.TERMINATED,
      });
    });

    it('terminates an ACTIVE mandate for OWNER', async () => {
      const result = await service.terminate(
        'mandate-1',
        'owner-1',
        Role.OWNER,
        {},
      );

      expect(repository.updateStatus).toHaveBeenCalledWith(
        'mandate-1',
        MandateStatus.TERMINATED,
      );
      expect(result.status).toBe(MandateStatus.TERMINATED);
    });

    it('allows ADMIN to terminate any mandate', async () => {
      const result = await service.terminate(
        'mandate-1',
        'admin-1',
        Role.ADMIN,
        {},
      );

      expect(result.status).toBe(MandateStatus.TERMINATED);
    });

    it('throws NotFoundException when mandate not found', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(
        service.terminate('unknown', 'owner-1', Role.OWNER, {}),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when non-owner tries to terminate', async () => {
      await expect(
        service.terminate('mandate-1', 'other-user', Role.OWNER, {}),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ConflictException when mandate is already TERMINATED', async () => {
      repository.findById.mockResolvedValue({
        ...MANDATE_STUB,
        status: MandateStatus.TERMINATED,
      });

      await expect(
        service.terminate('mandate-1', 'owner-1', Role.OWNER, {}),
      ).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException when mandate is already EXPIRED', async () => {
      repository.findById.mockResolvedValue({
        ...MANDATE_STUB,
        status: MandateStatus.EXPIRED,
      });

      await expect(
        service.terminate('mandate-1', 'owner-1', Role.OWNER, {}),
      ).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException("MANDATE_NOT_ACTIVE") when mandate is still PENDING (never accepted)', async () => {
      repository.findById.mockResolvedValue({
        ...MANDATE_STUB,
        status: MandateStatus.PENDING,
      });

      await expect(
        service.terminate('mandate-1', 'owner-1', Role.OWNER, {}),
      ).rejects.toThrow(
        "Ce mandat n'a pas encore été accepté par le gestionnaire",
      );
      expect(repository.updateStatus).not.toHaveBeenCalled();
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

  // ── accept ────────────────────────────────────────────────────────────────

  describe('accept', () => {
    const PENDING_MANDATE = { ...MANDATE_STUB, status: MandateStatus.PENDING };

    beforeEach(() => {
      prisma.tx.mandate.findFirst.mockResolvedValue(PENDING_MANDATE);
      prisma.tx.mandate.update.mockResolvedValue({
        ...PENDING_MANDATE,
        status: MandateStatus.ACTIVE,
      });
      prisma.property.findUnique.mockResolvedValue(PROPERTY_STUB);
      prisma.user.findUnique.mockImplementation(
        ({ where }: { where: { id: string } }) => {
          if (where.id === MANAGER_STUB.id)
            return Promise.resolve(MANAGER_STUB);
          if (where.id === OWNER_STUB.id) return Promise.resolve(OWNER_STUB);
          return Promise.resolve(null);
        },
      );
    });

    it('activates a PENDING mandate for its manager, inside a Serializable transaction', async () => {
      const result = await service.accept(
        'mandate-1',
        'manager-1',
        Role.MANAGER,
      );

      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: 'Serializable',
      });
      expect(prisma.tx.mandate.update).toHaveBeenCalledWith({
        where: { id: 'mandate-1' },
        data: { status: MandateStatus.ACTIVE },
      });
      expect(result.status).toBe(MandateStatus.ACTIVE);
    });

    it('assigns property.managerId inside the same transaction', async () => {
      await service.accept('mandate-1', 'manager-1', Role.MANAGER);

      expect(prisma.tx.property.update).toHaveBeenCalledWith({
        where: { id: 'property-1' },
        data: { managerId: 'manager-1' },
      });
    });

    it('allows ADMIN to accept on behalf of the manager', async () => {
      const result = await service.accept('mandate-1', 'admin-1', Role.ADMIN);

      expect(result.status).toBe(MandateStatus.ACTIVE);
    });

    it('throws NotFoundException when mandate does not exist', async () => {
      prisma.tx.mandate.findFirst.mockResolvedValue(null);

      await expect(
        service.accept('unknown', 'manager-1', Role.MANAGER),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when a different user tries to accept', async () => {
      await expect(
        service.accept('mandate-1', 'other-manager', Role.MANAGER),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when the property owner tries to accept', async () => {
      await expect(
        service.accept('mandate-1', 'owner-1', Role.OWNER),
      ).rejects.toThrow(ForbiddenException);
    });

    it.each([
      MandateStatus.ACTIVE,
      MandateStatus.TERMINATED,
      MandateStatus.EXPIRED,
      MandateStatus.REFUSED,
    ])(
      'throws ConflictException when mandate is already %s',
      async (status) => {
        prisma.tx.mandate.findFirst.mockResolvedValue({
          ...PENDING_MANDATE,
          status,
        });

        await expect(
          service.accept('mandate-1', 'manager-1', Role.MANAGER),
        ).rejects.toThrow('Ce mandat a déjà été traité');
      },
    );

    it('sends notification and email to the owner after acceptance', async () => {
      await service.accept('mandate-1', 'manager-1', Role.MANAGER);

      expect(notificationRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'owner-1',
          type: 'mandate_accepted',
        }),
      );
      expect(emailQueue.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'owner@test.cm',
          template: 'mandate-accepted',
        }),
      );
    });
  });

  // ── refuse ────────────────────────────────────────────────────────────────

  describe('refuse', () => {
    const PENDING_MANDATE = { ...MANDATE_STUB, status: MandateStatus.PENDING };

    beforeEach(() => {
      prisma.tx.mandate.findFirst.mockResolvedValue(PENDING_MANDATE);
      prisma.tx.mandate.update.mockResolvedValue({
        ...PENDING_MANDATE,
        status: MandateStatus.REFUSED,
      });
      prisma.property.findUnique.mockResolvedValue(PROPERTY_STUB);
      prisma.user.findUnique.mockImplementation(
        ({ where }: { where: { id: string } }) => {
          if (where.id === MANAGER_STUB.id)
            return Promise.resolve(MANAGER_STUB);
          if (where.id === OWNER_STUB.id) return Promise.resolve(OWNER_STUB);
          return Promise.resolve(null);
        },
      );
    });

    it('refuses a PENDING mandate for its manager, inside a Serializable transaction', async () => {
      const result = await service.refuse(
        'mandate-1',
        'manager-1',
        Role.MANAGER,
      );

      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: 'Serializable',
      });
      expect(prisma.tx.mandate.update).toHaveBeenCalledWith({
        where: { id: 'mandate-1' },
        data: { status: MandateStatus.REFUSED },
      });
      expect(result.status).toBe(MandateStatus.REFUSED);
    });

    it('does NOT touch property.managerId', async () => {
      await service.refuse('mandate-1', 'manager-1', Role.MANAGER);

      expect(prisma.tx.property.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when mandate does not exist', async () => {
      prisma.tx.mandate.findFirst.mockResolvedValue(null);

      await expect(
        service.refuse('unknown', 'manager-1', Role.MANAGER),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when a different user tries to refuse', async () => {
      await expect(
        service.refuse('mandate-1', 'other-manager', Role.MANAGER),
      ).rejects.toThrow(ForbiddenException);
    });

    it.each([
      MandateStatus.ACTIVE,
      MandateStatus.TERMINATED,
      MandateStatus.EXPIRED,
      MandateStatus.REFUSED,
    ])(
      'throws ConflictException when mandate is already %s',
      async (status) => {
        prisma.tx.mandate.findFirst.mockResolvedValue({
          ...PENDING_MANDATE,
          status,
        });

        await expect(
          service.refuse('mandate-1', 'manager-1', Role.MANAGER),
        ).rejects.toThrow('Ce mandat a déjà été traité');
      },
    );

    it('sends notification and email to the owner with the exact AC-mandated text', async () => {
      await service.refuse('mandate-1', 'manager-1', Role.MANAGER);

      expect(notificationRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'owner-1',
          type: 'mandate_refused',
          title: 'Votre demande de délégation a été refusée',
        }),
      );
      expect(emailQueue.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'owner@test.cm',
          template: 'mandate-refused',
          subject: 'Votre demande de délégation a été refusée',
        }),
      );
    });
  });
});
