import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { MaintenanceStatus, MaintenanceUrgency, Role } from '@prisma/client';
import { MaintenanceService } from './maintenance.service';

// ─── Mock factories ───────────────────────────────────────────────────────────

function mockPrisma() {
  return {
    property: { findFirst: jest.fn() },
    tenant: { findFirst: jest.fn(), findUnique: jest.fn() },
    contract: { findFirst: jest.fn() },
    maintenanceRequest: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    mandate: { findMany: jest.fn().mockResolvedValue([]) },
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
    uploadBuffer: jest.fn((key: string) => Promise.resolve(`https://cdn.r2.dev/${key}`)),
  };
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const OWNER_USER = { id: 'owner-1', role: Role.OWNER } as never;
const TENANT_USER = { id: 'user-tenant-1', role: Role.TENANT } as never;
const MANAGER_USER = { id: 'manager-1', role: Role.MANAGER } as never;
const ADMIN_USER = { id: 'admin-1', role: Role.ADMIN } as never;

const PROPERTY = {
  id: 'prop-1',
  title: 'Villa Bastos',
  ownerId: 'owner-1',
  owner: { id: 'owner-1', email: 'owner@test.cm', firstName: 'Marc', lastName: 'Dupont' },
};

const TENANT_RECORD = { id: 'tenant-uuid-1', userId: 'user-tenant-1', email: 'tenant@test.cm', firstName: 'Alice', lastName: 'Ngo' };

const MAINTENANCE_REQUEST = {
  id: 'maint-1',
  propertyId: 'prop-1',
  tenantId: 'tenant-uuid-1',
  title: 'Fuite eau',
  status: MaintenanceStatus.OPEN,
  urgency: MaintenanceUrgency.NORMAL,
  images: [],
  property: { ownerId: 'owner-1', title: 'Villa Bastos' },
};

const CREATE_DTO = {
  propertyId: 'prop-1',
  title: 'Fuite eau',
  description: 'Le robinet fuit dans la cuisine.',
  urgency: MaintenanceUrgency.NORMAL,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('MaintenanceService', () => {
  let service: MaintenanceService;
  let prisma: ReturnType<typeof mockPrisma>;
  let notifRepo: ReturnType<typeof mockNotificationRepo>;
  let emailQueue: ReturnType<typeof mockEmailQueue>;
  let mandateRepo: ReturnType<typeof mockMandateRepo>;
  let storage: ReturnType<typeof mockStorage>;

  beforeEach(() => {
    prisma = mockPrisma();
    notifRepo = mockNotificationRepo();
    emailQueue = mockEmailQueue();
    mandateRepo = mockMandateRepo();
    storage = mockStorage();
    service = new MaintenanceService(
      prisma as never,
      notifRepo as never,
      emailQueue as never,
      mandateRepo as never,
      storage as never,
    );
  });

  // ── create ────────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('OWNER can create a maintenance request for own property', async () => {
      prisma.property.findFirst.mockResolvedValue(PROPERTY);
      prisma.maintenanceRequest.create.mockResolvedValue({ ...MAINTENANCE_REQUEST, tenantId: null });

      const result = await service.create(OWNER_USER, CREATE_DTO);

      expect(result.id).toBe('maint-1');
      expect(notifRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'owner-1', type: 'maintenance_created' }),
      );
      expect(emailQueue.sendEmail).toHaveBeenCalledTimes(1);
    });

    it('TENANT with active contract can create a request', async () => {
      prisma.property.findFirst.mockResolvedValue(PROPERTY);
      prisma.tenant.findFirst.mockResolvedValue(TENANT_RECORD);
      prisma.contract.findFirst.mockResolvedValue({ id: 'contract-1' });
      prisma.maintenanceRequest.create.mockResolvedValue(MAINTENANCE_REQUEST);

      const result = await service.create(TENANT_USER, CREATE_DTO);

      expect(result.tenantId).toBe('tenant-uuid-1');
    });

    it('TENANT without active contract throws 403', async () => {
      prisma.property.findFirst.mockResolvedValue(PROPERTY);
      prisma.tenant.findFirst.mockResolvedValue(TENANT_RECORD);
      prisma.contract.findFirst.mockResolvedValue(null);

      await expect(service.create(TENANT_USER, CREATE_DTO)).rejects.toThrow(ForbiddenException);
    });

    it('CRITICAL urgency uses priority notification type', async () => {
      prisma.property.findFirst.mockResolvedValue(PROPERTY);
      prisma.maintenanceRequest.create.mockResolvedValue({
        ...MAINTENANCE_REQUEST,
        urgency: MaintenanceUrgency.CRITICAL,
        tenantId: null,
      });

      await service.create(OWNER_USER, { ...CREATE_DTO, urgency: MaintenanceUrgency.CRITICAL });

      expect(notifRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'maintenance_critical' }),
      );
    });

    it('throws 404 when property not found', async () => {
      prisma.property.findFirst.mockResolvedValue(null);

      await expect(service.create(OWNER_USER, CREATE_DTO)).rejects.toThrow(NotFoundException);
    });
  });

  // ── updateStatus ──────────────────────────────────────────────────────────────

  describe('updateStatus', () => {
    it('Owner can move OPEN → IN_PROGRESS', async () => {
      prisma.maintenanceRequest.findUnique.mockResolvedValue(MAINTENANCE_REQUEST);
      prisma.maintenanceRequest.update.mockResolvedValue({ ...MAINTENANCE_REQUEST, status: MaintenanceStatus.IN_PROGRESS });
      prisma.tenant.findUnique.mockResolvedValue(TENANT_RECORD);

      const result = await service.updateStatus(OWNER_USER, 'maint-1', { status: MaintenanceStatus.IN_PROGRESS });

      expect(result.status).toBe(MaintenanceStatus.IN_PROGRESS);
    });

    it('Owner can move IN_PROGRESS → RESOLVED', async () => {
      prisma.maintenanceRequest.findUnique.mockResolvedValue({ ...MAINTENANCE_REQUEST, status: MaintenanceStatus.IN_PROGRESS });
      prisma.maintenanceRequest.update.mockResolvedValue({ ...MAINTENANCE_REQUEST, status: MaintenanceStatus.RESOLVED });
      prisma.tenant.findUnique.mockResolvedValue(TENANT_RECORD);

      const result = await service.updateStatus(OWNER_USER, 'maint-1', { status: MaintenanceStatus.RESOLVED });

      expect(result.status).toBe(MaintenanceStatus.RESOLVED);
    });

    it('Tenant can close (RESOLVED → CLOSED)', async () => {
      prisma.maintenanceRequest.findUnique.mockResolvedValue({ ...MAINTENANCE_REQUEST, status: MaintenanceStatus.RESOLVED });
      prisma.tenant.findFirst.mockResolvedValue(TENANT_RECORD);
      prisma.maintenanceRequest.update.mockResolvedValue({ ...MAINTENANCE_REQUEST, status: MaintenanceStatus.CLOSED });
      prisma.tenant.findUnique.mockResolvedValue(TENANT_RECORD);

      const result = await service.updateStatus(TENANT_USER, 'maint-1', { status: MaintenanceStatus.CLOSED });

      expect(result.status).toBe(MaintenanceStatus.CLOSED);
    });

    it('Tenant can reopen (RESOLVED → OPEN)', async () => {
      prisma.maintenanceRequest.findUnique.mockResolvedValue({ ...MAINTENANCE_REQUEST, status: MaintenanceStatus.RESOLVED });
      prisma.tenant.findFirst.mockResolvedValue(TENANT_RECORD);
      prisma.maintenanceRequest.update.mockResolvedValue({ ...MAINTENANCE_REQUEST, status: MaintenanceStatus.OPEN });
      prisma.tenant.findUnique.mockResolvedValue(TENANT_RECORD);

      const result = await service.updateStatus(TENANT_USER, 'maint-1', { status: MaintenanceStatus.OPEN });

      expect(result.status).toBe(MaintenanceStatus.OPEN);
    });

    it('Tenant cannot set IN_PROGRESS → 403', async () => {
      prisma.maintenanceRequest.findUnique.mockResolvedValue(MAINTENANCE_REQUEST);

      await expect(
        service.updateStatus(TENANT_USER, 'maint-1', { status: MaintenanceStatus.IN_PROGRESS }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('Invalid transition OPEN → CLOSED throws 400', async () => {
      prisma.maintenanceRequest.findUnique.mockResolvedValue(MAINTENANCE_REQUEST);
      prisma.tenant.findFirst.mockResolvedValue(TENANT_RECORD);

      await expect(
        service.updateStatus(TENANT_USER, 'maint-1', { status: MaintenanceStatus.CLOSED }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws 404 when request not found', async () => {
      prisma.maintenanceRequest.findUnique.mockResolvedValue(null);

      await expect(
        service.updateStatus(OWNER_USER, 'missing', { status: MaintenanceStatus.IN_PROGRESS }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── list ──────────────────────────────────────────────────────────────────────

  describe('list', () => {
    it('OWNER query filters by property.ownerId', async () => {
      prisma.maintenanceRequest.findMany.mockResolvedValue([MAINTENANCE_REQUEST]);
      prisma.maintenanceRequest.count.mockResolvedValue(1);

      const result = await service.list(OWNER_USER, {});

      expect(result.data).toHaveLength(1);
      expect(prisma.maintenanceRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ property: { ownerId: 'owner-1' } }),
        }),
      );
    });

    it('ADMIN receives all requests without scope filter', async () => {
      prisma.maintenanceRequest.findMany.mockResolvedValue([MAINTENANCE_REQUEST]);
      prisma.maintenanceRequest.count.mockResolvedValue(1);

      const result = await service.list(ADMIN_USER, {});

      expect(result.data).toHaveLength(1);
      const callArg = prisma.maintenanceRequest.findMany.mock.calls[0][0];
      expect(callArg.where.property).toBeUndefined();
    });

    it('MANAGER scopes to mandated properties', async () => {
      prisma.mandate.findMany.mockResolvedValue([{ propertyId: 'prop-1' }, { propertyId: 'prop-2' }]);
      prisma.maintenanceRequest.findMany.mockResolvedValue([]);
      prisma.maintenanceRequest.count.mockResolvedValue(0);

      await service.list(MANAGER_USER, {});

      expect(prisma.maintenanceRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ propertyId: { in: ['prop-1', 'prop-2'] } }),
        }),
      );
    });
  });

  // ── getMyRequests ─────────────────────────────────────────────────────────────

  describe('getMyRequests', () => {
    it('returns requests for authenticated tenant', async () => {
      prisma.tenant.findFirst.mockResolvedValue(TENANT_RECORD);
      prisma.maintenanceRequest.findMany.mockResolvedValue([MAINTENANCE_REQUEST]);

      const result = await service.getMyRequests('user-tenant-1');

      expect(result.data).toHaveLength(1);
      expect(prisma.maintenanceRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: 'tenant-uuid-1' } }),
      );
    });

    it('throws 404 when no tenant record exists', async () => {
      prisma.tenant.findFirst.mockResolvedValue(null);

      await expect(service.getMyRequests('user-x')).rejects.toThrow(NotFoundException);
    });
  });

  // ── addPhotos ─────────────────────────────────────────────────────────────────

  describe('addPhotos', () => {
    const FILE = {
      originalname: 'photo.jpg',
      mimetype: 'image/jpeg',
      buffer: Buffer.from('img'),
    } as Express.Multer.File;

    it('OWNER can upload photos and they are appended', async () => {
      prisma.maintenanceRequest.findUnique.mockResolvedValue(MAINTENANCE_REQUEST);
      prisma.maintenanceRequest.update.mockResolvedValue({
        images: ['https://cdn.r2.dev/maintenance/maint-1/photos/uuid.jpg'],
      });

      const result = await service.addPhotos(OWNER_USER, 'maint-1', [FILE]);

      expect(storage.uploadBuffer).toHaveBeenCalledTimes(1);
      expect(result.images).toHaveLength(1);
    });

    it('TENANT who is the creator can upload photos', async () => {
      prisma.maintenanceRequest.findUnique.mockResolvedValue(MAINTENANCE_REQUEST);
      prisma.tenant.findFirst.mockResolvedValue(TENANT_RECORD);
      prisma.maintenanceRequest.update.mockResolvedValue({ images: ['https://cdn.r2.dev/maintenance/maint-1/photos/uuid.jpg'] });

      const result = await service.addPhotos(TENANT_USER, 'maint-1', [FILE]);

      expect(result.images).toHaveLength(1);
    });

    it('TENANT who is NOT the creator throws 403', async () => {
      prisma.maintenanceRequest.findUnique.mockResolvedValue(MAINTENANCE_REQUEST);
      prisma.tenant.findFirst.mockResolvedValue({ id: 'tenant-uuid-OTHER', userId: 'user-other' });

      await expect(service.addPhotos(TENANT_USER, 'maint-1', [FILE])).rejects.toThrow(ForbiddenException);
    });

    it('throws 404 when maintenance request not found', async () => {
      prisma.maintenanceRequest.findUnique.mockResolvedValue(null);

      await expect(service.addPhotos(OWNER_USER, 'missing', [FILE])).rejects.toThrow(NotFoundException);
    });

    it('throws 400 when more than 3 files submitted', async () => {
      prisma.maintenanceRequest.findUnique.mockResolvedValue(MAINTENANCE_REQUEST);
      const files = [FILE, FILE, FILE, FILE];

      await expect(service.addPhotos(OWNER_USER, 'maint-1', files)).rejects.toThrow(BadRequestException);
    });
  });
});
