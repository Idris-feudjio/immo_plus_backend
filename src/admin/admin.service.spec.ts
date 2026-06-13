import { NotFoundException } from '@nestjs/common';
import { AdminService } from './admin.service';

// ─── Mock ─────────────────────────────────────────────────────────────────────

function mockPrisma() {
  return {
    user: {
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const USER_STUB = {
  id: 'user-1',
  firstName: 'Alice',
  lastName: 'Dupont',
  email: 'alice@test.cm',
  phone: null,
  role: 'OWNER',
  avatarUrl: null,
  emailVerified: true,
  isActive: true,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AdminService', () => {
  let service: AdminService;
  let prisma: ReturnType<typeof mockPrisma>;

  beforeEach(() => {
    prisma = mockPrisma();
    service = new AdminService(prisma as never);
  });

  // ── listUsers ─────────────────────────────────────────────────────────────

  describe('listUsers', () => {
    beforeEach(() => {
      prisma.user.findMany.mockResolvedValue([USER_STUB]);
      prisma.user.count.mockResolvedValue(1);
    });

    it('returns paginated result with defaults (page=1, limit=10)', async () => {
      const result = await service.listUsers({});
      expect(result).toEqual({ data: [USER_STUB], total: 1, page: 1, limit: 10 });
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
      await service.listUsers({ role: 'TENANT' as any });
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ role: 'TENANT' }) }),
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
              { lastName: { contains: 'alice', mode: 'insensitive' } },
              { email: { contains: 'alice', mode: 'insensitive' } },
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
    it('returns updated user with isActive=false', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
      const deactivated = { ...USER_STUB, isActive: false };
      prisma.user.update.mockResolvedValue(deactivated);

      const result = await service.deactivateUser('user-1');

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'user-1' }, data: { isActive: false } }),
      );
      expect(result).toEqual(deactivated);
    });

    it('throws NotFoundException when user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.deactivateUser('unknown-id')).rejects.toThrow(NotFoundException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('never selects passwordHash in the update result', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
      prisma.user.update.mockResolvedValue(USER_STUB);

      await service.deactivateUser('user-1');

      const call = prisma.user.update.mock.calls[0][0] as any;
      expect(call.select).toBeDefined();
      expect(call.select.passwordHash).toBeUndefined();
    });
  });
});
