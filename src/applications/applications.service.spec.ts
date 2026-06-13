import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ApplicationStatus } from '@prisma/client';
import { ApplicationsService } from './applications.service';

// ─── Mock factories ───────────────────────────────────────────────────────────

function mockPrisma() {
  return {
    property: { findFirst: jest.fn() },
    application: { findMany: jest.fn(), count: jest.fn(), create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  };
}

function mockNotificationRepo() {
  return { create: jest.fn().mockResolvedValue({}) };
}

function mockEmailQueue() {
  return { sendEmail: jest.fn().mockResolvedValue(undefined) };
}

function mockMandateRepo() {
  return { findActiveByManager: jest.fn() };
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const OWNER_USER = { id: 'owner-1', email: 'owner@test.cm', role: 'OWNER', firstName: 'Marc', lastName: 'Dupont', isActive: true, avatarUrl: null };
const MANAGER_USER = { id: 'mgr-1', email: 'mgr@test.cm', role: 'MANAGER', firstName: 'Sara', lastName: 'Eba', isActive: true, avatarUrl: null };
const ADMIN_USER = { id: 'admin-1', email: 'admin@test.cm', role: 'ADMIN', firstName: 'Admin', lastName: 'A', isActive: true, avatarUrl: null };

const PROPERTY_OWNER_STUB = { id: 'owner-1', email: 'owner@test.cm', firstName: 'Marc', lastName: 'Dupont' };
const PROPERTY_MGR_STUB = { id: 'mgr-1', email: 'mgr@test.cm', firstName: 'Sara', lastName: 'Eba' };

const PROPERTY_STUB = {
  id: 'prop-1',
  title: 'Villa Bastos',
  city: 'Yaoundé',
  owner: PROPERTY_OWNER_STUB,
  manager: null,
};

const SUBMIT_DTO = {
  firstName: 'Alice',
  lastName: 'Ngo',
  email: 'alice@test.cm',
  phone: '699000001',
  propertyId: 'prop-1',
  message: 'Je suis intéressée.',
};

const APP_STUB = { id: 'app-1', propertyId: 'prop-1', status: ApplicationStatus.PENDING };

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ApplicationsService', () => {
  let service: ApplicationsService;
  let prisma: ReturnType<typeof mockPrisma>;
  let notifRepo: ReturnType<typeof mockNotificationRepo>;
  let emailQueue: ReturnType<typeof mockEmailQueue>;
  let mandateRepo: ReturnType<typeof mockMandateRepo>;

  beforeEach(() => {
    prisma = mockPrisma();
    notifRepo = mockNotificationRepo();
    emailQueue = mockEmailQueue();
    mandateRepo = mockMandateRepo();
    service = new ApplicationsService(
      prisma as never,
      notifRepo as never,
      emailQueue as never,
      mandateRepo as never,
    );
  });

  // ── submit ────────────────────────────────────────────────────────────────

  describe('submit', () => {
    beforeEach(() => {
      prisma.property.findFirst.mockResolvedValue(PROPERTY_STUB);
      prisma.application.create.mockResolvedValue({ id: 'app-1', status: 'PENDING' });
    });

    it('returns applicationId and PENDING status on success', async () => {
      const result = await service.submit(SUBMIT_DTO);
      expect(result).toEqual({ applicationId: 'app-1', status: 'PENDING' });
    });

    it('queries property with isPublished=true and deletedAt=null', async () => {
      await service.submit(SUBMIT_DTO);
      expect(prisma.property.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'prop-1', isPublished: true, deletedAt: null },
        }),
      );
    });

    it('creates application with all DTO fields', async () => {
      await service.submit(SUBMIT_DTO);
      expect(prisma.application.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            propertyId: 'prop-1',
            firstName: 'Alice',
            lastName: 'Ngo',
            email: 'alice@test.cm',
            phone: '699000001',
            message: 'Je suis intéressée.',
          },
        }),
      );
    });

    it('throws NotFoundException when property is not published or not found', async () => {
      prisma.property.findFirst.mockResolvedValue(null);
      await expect(service.submit(SUBMIT_DTO)).rejects.toThrow(NotFoundException);
      expect(prisma.application.create).not.toHaveBeenCalled();
    });

    it('creates in-app notification for owner', async () => {
      await service.submit(SUBMIT_DTO);
      expect(notifRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'owner-1', type: 'NEW_APPLICATION' }),
      );
    });

    it('queues email to owner', async () => {
      await service.submit(SUBMIT_DTO);
      expect(emailQueue.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'owner@test.cm', template: 'new-application' }),
      );
    });

    it('also notifies manager when property has a manager', async () => {
      prisma.property.findFirst.mockResolvedValue({ ...PROPERTY_STUB, manager: PROPERTY_MGR_STUB });
      await service.submit(SUBMIT_DTO);
      const notifUserIds = notifRepo.create.mock.calls.map((c: any[]) => c[0].userId);
      expect(notifUserIds).toContain('owner-1');
      expect(notifUserIds).toContain('mgr-1');
      const emailTos = emailQueue.sendEmail.mock.calls.map((c: any[]) => c[0].to);
      expect(emailTos).toContain('owner@test.cm');
      expect(emailTos).toContain('mgr@test.cm');
    });

    it('does NOT notify manager when property has no manager', async () => {
      await service.submit(SUBMIT_DTO);
      expect(notifRepo.create).toHaveBeenCalledTimes(1);
      expect(emailQueue.sendEmail).toHaveBeenCalledTimes(1);
    });
  });

  // ── listForProperty ───────────────────────────────────────────────────────

  describe('listForProperty', () => {
    const PROP_AUTH_STUB = { id: 'prop-1', ownerId: 'owner-1' };

    beforeEach(() => {
      prisma.property.findFirst.mockResolvedValue(PROP_AUTH_STUB);
      prisma.application.findMany.mockResolvedValue([APP_STUB]);
      prisma.application.count.mockResolvedValue(1);
    });

    it('returns paginated result for OWNER of the property', async () => {
      const result = await service.listForProperty(OWNER_USER as never, { propertyId: 'prop-1' });
      expect(result).toEqual({ data: [APP_STUB], total: 1, page: 1, limit: 20 });
    });

    it('returns paginated result for ADMIN regardless of ownership', async () => {
      prisma.property.findFirst.mockResolvedValue({ id: 'prop-1', ownerId: 'someone-else' });
      const result = await service.listForProperty(ADMIN_USER as never, { propertyId: 'prop-1' });
      expect(result.data).toEqual([APP_STUB]);
    });

    it('returns paginated result for MANAGER with active mandate', async () => {
      mandateRepo.findActiveByManager.mockResolvedValue({ id: 'mandate-1' });
      const result = await service.listForProperty(MANAGER_USER as never, { propertyId: 'prop-1' });
      expect(result.data).toEqual([APP_STUB]);
    });

    it('throws ForbiddenException for OWNER who does not own the property', async () => {
      prisma.property.findFirst.mockResolvedValue({ id: 'prop-1', ownerId: 'other-owner' });
      await expect(
        service.listForProperty(OWNER_USER as never, { propertyId: 'prop-1' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException(NO_ACTIVE_MANDATE) for MANAGER without mandate', async () => {
      mandateRepo.findActiveByManager.mockResolvedValue(null);
      await expect(
        service.listForProperty(MANAGER_USER as never, { propertyId: 'prop-1' }),
      ).rejects.toThrow('NO_ACTIVE_MANDATE');
    });

    it('throws NotFoundException when property does not exist', async () => {
      prisma.property.findFirst.mockResolvedValue(null);
      await expect(
        service.listForProperty(OWNER_USER as never, { propertyId: 'prop-x' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('applies status filter when provided', async () => {
      await service.listForProperty(OWNER_USER as never, { propertyId: 'prop-1', status: ApplicationStatus.PENDING });
      expect(prisma.application.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: ApplicationStatus.PENDING }),
        }),
      );
    });
  });

  // ── updateStatus ──────────────────────────────────────────────────────────

  describe('updateStatus', () => {
    const PROP_AUTH_STUB = { id: 'prop-1', ownerId: 'owner-1' };

    beforeEach(() => {
      prisma.application.findUnique.mockResolvedValue(APP_STUB);
      prisma.property.findFirst.mockResolvedValue(PROP_AUTH_STUB);
      prisma.application.update.mockResolvedValue({ ...APP_STUB, status: ApplicationStatus.ACCEPTED });
    });

    it('returns updated application with ACCEPTED status', async () => {
      const result = await service.updateStatus(OWNER_USER as never, 'app-1', ApplicationStatus.ACCEPTED);
      expect(result.status).toBe(ApplicationStatus.ACCEPTED);
      expect(prisma.application.update).toHaveBeenCalledWith({
        where: { id: 'app-1' },
        data: { status: ApplicationStatus.ACCEPTED },
      });
    });

    it('returns updated application with REJECTED status', async () => {
      prisma.application.update.mockResolvedValue({ ...APP_STUB, status: ApplicationStatus.REJECTED });
      const result = await service.updateStatus(OWNER_USER as never, 'app-1', ApplicationStatus.REJECTED);
      expect(result.status).toBe(ApplicationStatus.REJECTED);
    });

    it('throws NotFoundException when application does not exist', async () => {
      prisma.application.findUnique.mockResolvedValue(null);
      await expect(
        service.updateStatus(OWNER_USER as never, 'bad-id', ApplicationStatus.ACCEPTED),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.application.update).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException for OWNER who does not own the property', async () => {
      prisma.property.findFirst.mockResolvedValue({ id: 'prop-1', ownerId: 'other-owner' });
      await expect(
        service.updateStatus(OWNER_USER as never, 'app-1', ApplicationStatus.ACCEPTED),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.application.update).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException for MANAGER without mandate', async () => {
      mandateRepo.findActiveByManager.mockResolvedValue(null);
      await expect(
        service.updateStatus(MANAGER_USER as never, 'app-1', ApplicationStatus.ACCEPTED),
      ).rejects.toThrow('NO_ACTIVE_MANDATE');
    });
  });
});
