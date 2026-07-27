import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ApplicationStatus, Gender } from '@prisma/client';
import { ApplicationsService } from './applications.service';

// ─── Mock factories ───────────────────────────────────────────────────────────

function mockPrisma() {
  const tx = {
    application: { findFirst: jest.fn(), create: jest.fn() },
  };
  return {
    property: { findFirst: jest.fn() },
    application: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
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
    findByUser: jest.fn(),
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

function mockStorage() {
  return {
    uploadBuffer: jest
      .fn()
      .mockResolvedValue('https://cdn.example.com/uploaded.pdf'),
  };
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TENANT_USER = {
  id: 'tenant-user-1',
  email: 'alice@test.cm',
  role: 'TENANT',
  firstName: 'Alice',
  lastName: 'Ngo',
  isActive: true,
  avatarUrl: null,
};
const OWNER_USER = {
  id: 'owner-1',
  email: 'owner@test.cm',
  role: 'OWNER',
  firstName: 'Marc',
  lastName: 'Dupont',
  isActive: true,
  avatarUrl: null,
};
const MANAGER_USER = {
  id: 'mgr-1',
  email: 'mgr@test.cm',
  role: 'MANAGER',
  firstName: 'Sara',
  lastName: 'Eba',
  isActive: true,
  avatarUrl: null,
};
const ADMIN_USER = {
  id: 'admin-1',
  email: 'admin@test.cm',
  role: 'ADMIN',
  firstName: 'Admin',
  lastName: 'A',
  isActive: true,
  avatarUrl: null,
};

const PROPERTY_OWNER_STUB = {
  id: 'owner-1',
  email: 'owner@test.cm',
  firstName: 'Marc',
  lastName: 'Dupont',
};
const PROPERTY_MGR_STUB = {
  id: 'mgr-1',
  email: 'mgr@test.cm',
  firstName: 'Sara',
  lastName: 'Eba',
};

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
  gender: Gender.FEMALE,
  nationalIdNumber: '1234567890123',
  phone: '+237699000001',
  income: 350000,
  propertyId: 'prop-1',
};

const APP_STUB = {
  id: 'app-1',
  propertyId: 'prop-1',
  status: ApplicationStatus.PENDING,
};

const APP_DETAIL_STUB = {
  id: 'app-1',
  propertyId: 'prop-1',
  userId: 'tenant-user-1',
  email: 'alice@test.cm',
  firstName: 'Alice',
  lastName: 'Ngo',
  status: ApplicationStatus.PENDING,
  property: { title: 'Villa Bastos' },
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ApplicationsService', () => {
  let service: ApplicationsService;
  let prisma: ReturnType<typeof mockPrisma>;
  let repository: ReturnType<typeof mockRepository>;
  let notifRepo: ReturnType<typeof mockNotificationRepo>;
  let emailQueue: ReturnType<typeof mockEmailQueue>;
  let mandateRepo: ReturnType<typeof mockMandateRepo>;
  let storage: ReturnType<typeof mockStorage>;

  beforeEach(() => {
    prisma = mockPrisma();
    repository = mockRepository();
    notifRepo = mockNotificationRepo();
    emailQueue = mockEmailQueue();
    mandateRepo = mockMandateRepo();
    storage = mockStorage();
    service = new ApplicationsService(
      repository as never,
      prisma as never,
      notifRepo as never,
      emailQueue as never,
      mandateRepo as never,
      storage as never,
    );
  });

  // ── submit ────────────────────────────────────────────────────────────────

  describe('submit', () => {
    beforeEach(() => {
      prisma.property.findFirst.mockResolvedValue(PROPERTY_STUB);
      prisma._tx.application.findFirst.mockResolvedValue(null);
      prisma._tx.application.create.mockResolvedValue({
        id: 'app-1',
        status: 'PENDING',
      });
    });

    it('returns applicationId and PENDING status on success', async () => {
      const result = await service.submit(TENANT_USER as never, SUBMIT_DTO);
      expect(result).toEqual({ applicationId: 'app-1', status: 'PENDING' });
    });

    it('queries property with isPublished=true and deletedAt=null', async () => {
      await service.submit(TENANT_USER as never, SUBMIT_DTO);
      expect(prisma.property.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'prop-1', isPublished: true, deletedAt: null },
        }),
      );
    });

    it('checks for an existing PENDING/ACCEPTED application for this user+property inside a serializable transaction', async () => {
      await service.submit(TENANT_USER as never, SUBMIT_DTO);
      expect(prisma.$transaction).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ isolationLevel: 'Serializable' }),
      );
      expect(prisma._tx.application.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId: 'tenant-user-1',
            propertyId: 'prop-1',
            status: {
              in: [ApplicationStatus.PENDING, ApplicationStatus.ACCEPTED],
            },
          },
        }),
      );
    });

    it('creates application with userId, email from the authenticated user, and DTO fields', async () => {
      await service.submit(TENANT_USER as never, SUBMIT_DTO);
      expect(prisma._tx.application.create).toHaveBeenCalledWith({
        data: {
          propertyId: 'prop-1',
          userId: 'tenant-user-1',
          firstName: 'Alice',
          lastName: 'Ngo',
          email: 'alice@test.cm',
          phone: '+237699000001',
          gender: Gender.FEMALE,
          nationalIdNumber: '1234567890123',
          income: 350000,
        },
      });
    });

    it('throws NotFoundException when property is not published or not found', async () => {
      prisma.property.findFirst.mockResolvedValue(null);
      await expect(
        service.submit(TENANT_USER as never, SUBMIT_DTO),
      ).rejects.toThrow(NotFoundException);
      expect(prisma._tx.application.create).not.toHaveBeenCalled();
    });

    it('throws ConflictException (409) when a PENDING/ACCEPTED application already exists for this property', async () => {
      prisma._tx.application.findFirst.mockResolvedValue({
        id: 'existing-app',
      });
      await expect(
        service.submit(TENANT_USER as never, SUBMIT_DTO),
      ).rejects.toThrow(ConflictException);
      expect(prisma._tx.application.create).not.toHaveBeenCalled();
    });

    it('does not fail the request when owner/manager notification dispatch throws', async () => {
      emailQueue.sendEmail.mockRejectedValueOnce(new Error('SES down'));
      const result = await service.submit(TENANT_USER as never, SUBMIT_DTO);
      expect(result).toEqual({ applicationId: 'app-1', status: 'PENDING' });
    });

    it('creates in-app notification for owner', async () => {
      await service.submit(TENANT_USER as never, SUBMIT_DTO);
      expect(notifRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'owner-1', type: 'NEW_APPLICATION' }),
      );
    });

    it('queues email to owner', async () => {
      await service.submit(TENANT_USER as never, SUBMIT_DTO);
      expect(emailQueue.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'owner@test.cm',
          template: 'new-application',
        }),
      );
    });

    it('also notifies manager when property has a manager', async () => {
      prisma.property.findFirst.mockResolvedValue({
        ...PROPERTY_STUB,
        manager: PROPERTY_MGR_STUB,
      });
      await service.submit(TENANT_USER as never, SUBMIT_DTO);
      const notifUserIds = notifRepo.create.mock.calls.map(
        (c: [{ userId: string }]) => c[0].userId,
      );
      expect(notifUserIds).toContain('owner-1');
      expect(notifUserIds).toContain('mgr-1');
      const emailTos = emailQueue.sendEmail.mock.calls.map(
        (c: [{ to: string }]) => c[0].to,
      );
      expect(emailTos).toContain('owner@test.cm');
      expect(emailTos).toContain('mgr@test.cm');
    });

    it('does NOT notify manager when property has no manager', async () => {
      await service.submit(TENANT_USER as never, SUBMIT_DTO);
      expect(notifRepo.create).toHaveBeenCalledTimes(1);
      expect(emailQueue.sendEmail).toHaveBeenCalledTimes(1);
    });
  });

  // ── addAttachments ───────────────────────────────────────────────────────────

  describe('addAttachments', () => {
    const FILES = [
      {
        originalname: 'cni.pdf',
        mimetype: 'application/pdf',
        buffer: Buffer.from('x'),
      },
    ] as Express.Multer.File[];

    beforeEach(() => {
      prisma.application.findUnique.mockResolvedValue({
        id: 'app-1',
        userId: 'tenant-user-1',
        status: ApplicationStatus.PENDING,
        attachments: [],
      });
      prisma.application.update.mockResolvedValue({
        attachments: ['https://cdn.example.com/uploaded.pdf'],
      });
    });

    it('uploads each file to R2 with the applications/{id}/{fileId}.{ext} key pattern', async () => {
      await service.addAttachments(TENANT_USER as never, 'app-1', FILES);
      expect(storage.uploadBuffer).toHaveBeenCalledWith(
        expect.stringMatching(/^applications\/app-1\/[\w-]+\.pdf$/),
        FILES[0].buffer,
        'application/pdf',
      );
    });

    it('returns the updated attachments array', async () => {
      const result = await service.addAttachments(
        TENANT_USER as never,
        'app-1',
        FILES,
      );
      expect(result).toEqual({
        attachments: ['https://cdn.example.com/uploaded.pdf'],
      });
    });

    it('throws NotFoundException when the application does not exist', async () => {
      prisma.application.findUnique.mockResolvedValue(null);
      await expect(
        service.addAttachments(TENANT_USER as never, 'bad-id', FILES),
      ).rejects.toThrow(NotFoundException);
      expect(storage.uploadBuffer).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when the application does not belong to the authenticated user', async () => {
      prisma.application.findUnique.mockResolvedValue({
        id: 'app-1',
        userId: 'someone-else',
        status: ApplicationStatus.PENDING,
        attachments: [],
      });
      await expect(
        service.addAttachments(TENANT_USER as never, 'app-1', FILES),
      ).rejects.toThrow(ForbiddenException);
      expect(storage.uploadBuffer).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when no files are provided', async () => {
      await expect(
        service.addAttachments(TENANT_USER as never, 'app-1', []),
      ).rejects.toThrow('NO_FILES');
      expect(prisma.application.findUnique).not.toHaveBeenCalled();
      expect(storage.uploadBuffer).not.toHaveBeenCalled();
    });

    it('throws ConflictException when the application is no longer PENDING', async () => {
      prisma.application.findUnique.mockResolvedValue({
        id: 'app-1',
        userId: 'tenant-user-1',
        status: ApplicationStatus.ACCEPTED,
        attachments: [],
      });
      await expect(
        service.addAttachments(TENANT_USER as never, 'app-1', FILES),
      ).rejects.toThrow('APPLICATION_ALREADY_DECIDED');
      expect(storage.uploadBuffer).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when adding files would exceed the 5-attachment cap', async () => {
      prisma.application.findUnique.mockResolvedValue({
        id: 'app-1',
        userId: 'tenant-user-1',
        status: ApplicationStatus.PENDING,
        attachments: Array(5).fill('https://cdn.example.com/existing.pdf'),
      });
      await expect(
        service.addAttachments(TENANT_USER as never, 'app-1', FILES),
      ).rejects.toThrow('TOO_MANY_ATTACHMENTS');
      expect(storage.uploadBuffer).not.toHaveBeenCalled();
    });
  });

  // ── findMyApplications ───────────────────────────────────────────────────────

  describe('findMyApplications', () => {
    it('returns { data } from repository.findByUser', async () => {
      const rows = [
        {
          id: 'app-1',
          status: 'PENDING',
          createdAt: new Date(),
          property: { id: 'prop-1', title: 'Villa Bastos' },
        },
      ];
      repository.findByUser.mockResolvedValue(rows);

      const result = await service.findMyApplications('tenant-user-1');

      expect(repository.findByUser).toHaveBeenCalledWith('tenant-user-1');
      expect(result).toEqual({ data: rows });
    });
  });

  // ── search ───────────────────────────────────────────────────────────────

  describe('search', () => {
    const PROP_AUTH_STUB = { id: 'prop-1', ownerId: 'owner-1' };
    const PAGINATED = {
      data: [APP_STUB],
      meta: { total: 1, pageSize: 20, pageNumber: 0, totalPages: 1 },
    };

    beforeEach(() => {
      prisma.property.findFirst.mockResolvedValue(PROP_AUTH_STUB);
      repository.findWithPagination.mockResolvedValue(PAGINATED);
    });

    it('returns paginated result for OWNER of the property', async () => {
      const result = await service.search(OWNER_USER as never, {
        filters: { propertyId: ['prop-1'] },
      });
      expect(result.data).toEqual([APP_STUB]);
    });

    it('returns paginated result for ADMIN regardless of ownership', async () => {
      prisma.property.findFirst.mockResolvedValue({
        id: 'prop-1',
        ownerId: 'someone-else',
      });
      const result = await service.search(ADMIN_USER as never, {
        filters: { propertyId: ['prop-1'] },
      });
      expect(result.data).toEqual([APP_STUB]);
    });

    it('returns paginated result for MANAGER with active mandate', async () => {
      mandateRepo.findActiveByManager.mockResolvedValue({ id: 'mandate-1' });
      const result = await service.search(MANAGER_USER as never, {
        filters: { propertyId: ['prop-1'] },
      });
      expect(result.data).toEqual([APP_STUB]);
    });

    it('throws ForbiddenException for OWNER who does not own the property', async () => {
      prisma.property.findFirst.mockResolvedValue({
        id: 'prop-1',
        ownerId: 'other-owner',
      });
      await expect(
        service.search(OWNER_USER as never, {
          filters: { propertyId: ['prop-1'] },
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException(NO_ACTIVE_MANDATE) for MANAGER without mandate', async () => {
      mandateRepo.findActiveByManager.mockResolvedValue(null);
      await expect(
        service.search(MANAGER_USER as never, {
          filters: { propertyId: ['prop-1'] },
        }),
      ).rejects.toThrow('NO_ACTIVE_MANDATE');
    });

    it('throws NotFoundException when property does not exist', async () => {
      prisma.property.findFirst.mockResolvedValue(null);
      await expect(
        service.search(OWNER_USER as never, {
          filters: { propertyId: ['prop-x'] },
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when no propertyId in filters', async () => {
      await expect(service.search(OWNER_USER as never, {})).rejects.toThrow(
        NotFoundException,
      );
    });

    it('passes the query with filters to repository', async () => {
      const query = {
        filters: {
          propertyId: ['prop-1'],
          status: [ApplicationStatus.PENDING],
        },
      };
      await service.search(OWNER_USER as never, query);
      expect(repository.findWithPagination).toHaveBeenCalledWith(query, {
        propertyId: 'prop-1',
      });
    });
  });

  // ── updateStatus ──────────────────────────────────────────────────────────

  describe('updateStatus', () => {
    const PROP_AUTH_STUB = { id: 'prop-1', ownerId: 'owner-1' };

    beforeEach(() => {
      prisma.application.findUnique.mockResolvedValue(APP_DETAIL_STUB);
      prisma.property.findFirst.mockResolvedValue(PROP_AUTH_STUB);
      repository.findByIdOrThrow.mockResolvedValue(APP_STUB);
      repository.update.mockResolvedValue({
        ...APP_STUB,
        status: ApplicationStatus.ACCEPTED,
      });
    });

    it('returns updated application with ACCEPTED status', async () => {
      const result = await service.updateStatus(
        OWNER_USER as never,
        'app-1',
        ApplicationStatus.ACCEPTED,
      );
      expect(result.status).toBe(ApplicationStatus.ACCEPTED);
      expect(repository.update).toHaveBeenCalledWith('app-1', {
        status: ApplicationStatus.ACCEPTED,
      });
    });

    it('returns updated application with REJECTED status', async () => {
      repository.update.mockResolvedValue({
        ...APP_STUB,
        status: ApplicationStatus.REJECTED,
      });
      const result = await service.updateStatus(
        OWNER_USER as never,
        'app-1',
        ApplicationStatus.REJECTED,
      );
      expect(result.status).toBe(ApplicationStatus.REJECTED);
    });

    it('notifies the candidate in-app and by email when ACCEPTED', async () => {
      await service.updateStatus(
        OWNER_USER as never,
        'app-1',
        ApplicationStatus.ACCEPTED,
      );
      expect(notifRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'tenant-user-1',
          type: 'APPLICATION_ACCEPTED',
        }),
      );
      const [emailCall] = emailQueue.sendEmail.mock.calls.map(
        (c: [{ to: string; template: string; data: { message: string } }]) =>
          c[0],
      );
      expect(emailCall.to).toBe('alice@test.cm');
      expect(emailCall.template).toBe('application-accepted');
      expect(emailCall.data.message).toBe(
        'Votre dossier a été accepté pour Villa Bastos.',
      );
    });

    it('notifies the candidate in-app and by email when REJECTED', async () => {
      await service.updateStatus(
        OWNER_USER as never,
        'app-1',
        ApplicationStatus.REJECTED,
      );
      expect(notifRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'tenant-user-1',
          type: 'APPLICATION_REJECTED',
        }),
      );
      const [emailCall] = emailQueue.sendEmail.mock.calls.map(
        (c: [{ to: string; template: string; data: { message: string } }]) =>
          c[0],
      );
      expect(emailCall.to).toBe('alice@test.cm');
      expect(emailCall.template).toBe('application-rejected');
      expect(emailCall.data.message).toBe(
        "Votre dossier n'a pas été retenu pour Villa Bastos.",
      );
    });

    it('does not fail the request when candidate notification dispatch throws', async () => {
      emailQueue.sendEmail.mockRejectedValueOnce(new Error('SES down'));
      const result = await service.updateStatus(
        OWNER_USER as never,
        'app-1',
        ApplicationStatus.ACCEPTED,
      );
      expect(result.status).toBe(ApplicationStatus.ACCEPTED);
    });

    it('throws ConflictException when the application was already decided', async () => {
      prisma.application.findUnique.mockResolvedValue({
        ...APP_DETAIL_STUB,
        status: ApplicationStatus.REJECTED,
      });
      await expect(
        service.updateStatus(
          OWNER_USER as never,
          'app-1',
          ApplicationStatus.ACCEPTED,
        ),
      ).rejects.toThrow('APPLICATION_ALREADY_DECIDED');
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when application does not exist', async () => {
      prisma.application.findUnique.mockResolvedValue(null);
      await expect(
        service.updateStatus(
          OWNER_USER as never,
          'bad-id',
          ApplicationStatus.ACCEPTED,
        ),
      ).rejects.toThrow(NotFoundException);
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException for OWNER who does not own the property', async () => {
      prisma.property.findFirst.mockResolvedValue({
        id: 'prop-1',
        ownerId: 'other-owner',
      });
      await expect(
        service.updateStatus(
          OWNER_USER as never,
          'app-1',
          ApplicationStatus.ACCEPTED,
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException for MANAGER without mandate', async () => {
      mandateRepo.findActiveByManager.mockResolvedValue(null);
      await expect(
        service.updateStatus(
          MANAGER_USER as never,
          'app-1',
          ApplicationStatus.ACCEPTED,
        ),
      ).rejects.toThrow('NO_ACTIVE_MANDATE');
    });
  });
});
