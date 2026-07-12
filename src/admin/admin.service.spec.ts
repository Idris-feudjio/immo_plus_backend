import { NotFoundException } from '@nestjs/common';
import { AuditAction, Role } from '@prisma/client';
import { AdminService } from './admin.service';

// ─── Mocks ────────────────────────────────────────────────────────────────────

function mockPrisma() {
  return {
    user: {
      findMany:   jest.fn(),
      count:      jest.fn(),
      findUnique: jest.fn(),
      update:     jest.fn(),
    },
    refreshToken: {
      updateMany: jest.fn(),
    },
    adminAuditLog: {
      create: jest.fn(),
    },
    property:     { aggregate: jest.fn(), count: jest.fn() },
    contract:     { count: jest.fn() },
    payment:      { aggregate: jest.fn() },
    adminSettings: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
  };
}

function mockEmail() {
  return { sendEmail: jest.fn() };
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const USER_STUB = {
  id: 'user-1',
  firstName: 'Alice',
  lastName: 'Dupont',
  email: 'alice@test.cm',
  phone: null,
  role: Role.OWNER,
  avatarUrl: null,
  emailVerified: true,
  isActive: true,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

const CONTEXT = { adminId: 'admin-1', ip: '127.0.0.1', userAgent: 'test-agent' };

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AdminService', () => {
  let service: AdminService;
  let prisma: ReturnType<typeof mockPrisma>;
  let email: ReturnType<typeof mockEmail>;

  beforeEach(() => {
    prisma = mockPrisma();
    email  = mockEmail();
    service = new AdminService(prisma as never, email as never);
  });

  // ── listUsers ─────────────────────────────────────────────────────────────

  describe('listUsers', () => {
    beforeEach(() => {
      prisma.user.findMany.mockResolvedValue([USER_STUB]);
      prisma.user.count.mockResolvedValue(1);
    });

    it('returns paginated result with defaults (page=1, limit=20)', async () => {
      const result = await service.listUsers({});
      expect(result).toEqual({ data: [USER_STUB], total: 1, page: 1, limit: 20 });
    });

    it('applies explicit page and limit', async () => {
      await service.listUsers({ page: 2, limit: 5 });
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 5, take: 5 }),
      );
    });

    it('clamps limit to max 100', async () => {
      await service.listUsers({ limit: 9999 });
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 }),
      );
    });

    it('filters by role', async () => {
      await service.listUsers({ role: Role.TENANT });
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ role: Role.TENANT }) }),
      );
    });

    it('filters by isActive=false', async () => {
      await service.listUsers({ isActive: false });
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ isActive: false }) }),
      );
    });

    it('applies search as OR across firstName, lastName, email', async () => {
      await service.listUsers({ search: 'alice' });
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [
              { firstName: { contains: 'alice', mode: 'insensitive' } },
              { lastName:  { contains: 'alice', mode: 'insensitive' } },
              { email:     { contains: 'alice', mode: 'insensitive' } },
            ],
          }),
        }),
      );
    });

    it('never selects passwordHash', async () => {
      await service.listUsers({});
      const call = prisma.user.findMany.mock.calls[0][0] as any;
      expect(call.select).toBeDefined();
      expect(call.select.passwordHash).toBeUndefined();
    });

    it('runs findMany and count in parallel', async () => {
      await service.listUsers({});
      expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.user.count).toHaveBeenCalledTimes(1);
    });
  });

  // ── deactivateUser ────────────────────────────────────────────────────────

  describe('deactivateUser', () => {
    beforeEach(() => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: USER_STUB.email, firstName: USER_STUB.firstName });
      prisma.user.update.mockResolvedValue({ ...USER_STUB, isActive: false });
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 2 });
      prisma.adminAuditLog.create.mockResolvedValue({});
      email.sendEmail.mockResolvedValue(undefined);
    });

    it('met isActive=false et retourne l\'utilisateur mis à jour', async () => {
      const result = await service.deactivateUser('user-1', CONTEXT);
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'user-1' }, data: { isActive: false } }),
      );
      expect(result.isActive).toBe(false);
    });

    it('révoque tous les refresh tokens actifs', async () => {
      await service.deactivateUser('user-1', CONTEXT);
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', revokedAt: null },
        data:  { revokedAt: expect.any(Date) },
      });
    });

    it('envoie un email account-disabled', async () => {
      await service.deactivateUser('user-1', CONTEXT);
      expect(email.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: USER_STUB.email, template: 'account-disabled' }),
      );
    });

    it('écrit un audit log ACCOUNT_DISABLE avec result=SUCCESS', async () => {
      await service.deactivateUser('user-1', CONTEXT);
      expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          adminId:      CONTEXT.adminId,
          action:       AuditAction.ACCOUNT_DISABLE,
          targetUserId: 'user-1',
          ip:           CONTEXT.ip,
          userAgent:    CONTEXT.userAgent,
          result:       'SUCCESS',
        }),
      });
    });

    it('NotFoundException si utilisateur introuvable', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.deactivateUser('unknown-id', CONTEXT)).rejects.toThrow(NotFoundException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('never selects passwordHash in the update result', async () => {
      await service.deactivateUser('user-1', CONTEXT);
      const call = prisma.user.update.mock.calls[0][0] as any;
      expect(call.select).toBeDefined();
      expect(call.select.passwordHash).toBeUndefined();
    });
  });

  // ── reactivateUser ────────────────────────────────────────────────────────

  describe('reactivateUser', () => {
    beforeEach(() => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: USER_STUB.email, firstName: USER_STUB.firstName });
      prisma.user.update.mockResolvedValue({ ...USER_STUB, isActive: true });
      prisma.adminAuditLog.create.mockResolvedValue({});
      email.sendEmail.mockResolvedValue(undefined);
    });

    it('met isActive=true et retourne l\'utilisateur', async () => {
      const result = await service.reactivateUser('user-1', CONTEXT);
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'user-1' }, data: { isActive: true } }),
      );
      expect(result.isActive).toBe(true);
    });

    it('envoie un email account-reactivated', async () => {
      await service.reactivateUser('user-1', CONTEXT);
      expect(email.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: USER_STUB.email, template: 'account-reactivated' }),
      );
    });

    it('écrit un audit log ACCOUNT_ENABLE avec result=SUCCESS', async () => {
      await service.reactivateUser('user-1', CONTEXT);
      expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          adminId:      CONTEXT.adminId,
          action:       AuditAction.ACCOUNT_ENABLE,
          targetUserId: 'user-1',
          result:       'SUCCESS',
        }),
      });
    });

    it('NotFoundException si utilisateur introuvable', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.reactivateUser('unknown-id', CONTEXT)).rejects.toThrow(NotFoundException);
    });
  });

  // ── changeUserRole ────────────────────────────────────────────────────────

  describe('changeUserRole', () => {
    beforeEach(() => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
      prisma.user.update.mockResolvedValue({ ...USER_STUB, role: Role.MANAGER });
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
      prisma.adminAuditLog.create.mockResolvedValue({});
    });

    it('met à jour le rôle', async () => {
      const result = await service.changeUserRole('user-1', Role.MANAGER, CONTEXT);
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'user-1' }, data: { role: Role.MANAGER } }),
      );
      expect(result.role).toBe(Role.MANAGER);
    });

    it('révoque les refresh tokens', async () => {
      await service.changeUserRole('user-1', Role.MANAGER, CONTEXT);
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', revokedAt: null },
        data:  { revokedAt: expect.any(Date) },
      });
    });

    it('écrit un audit log ROLE_CHANGE avec result=nouveau rôle', async () => {
      await service.changeUserRole('user-1', Role.MANAGER, CONTEXT);
      expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          adminId:      CONTEXT.adminId,
          action:       AuditAction.ROLE_CHANGE,
          targetUserId: 'user-1',
          result:       Role.MANAGER,
        }),
      });
    });

    it('NotFoundException si utilisateur introuvable', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.changeUserRole('bad-id', Role.TENANT, CONTEXT)).rejects.toThrow(NotFoundException);
    });
  });
});
