import { MandateRepository } from './mandate.repository';

// ─── Mock ─────────────────────────────────────────────────────────────────────

function mockPrisma() {
  return {
    mandate: {
      findFirst: jest.fn(),
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('MandateRepository', () => {
  let repo: MandateRepository;
  let prisma: ReturnType<typeof mockPrisma>;

  beforeEach(() => {
    prisma = mockPrisma();
    repo = new MandateRepository(prisma as never);
  });

  describe('findActiveByManager', () => {
    it('queries with ACTIVE status and deletedAt: null', async () => {
      prisma.mandate.findFirst.mockResolvedValue({ id: 'mandate-1' });

      await repo.findActiveByManager('manager-1', 'property-1');

      expect(prisma.mandate.findFirst).toHaveBeenCalledWith({
        where: {
          managerId: 'manager-1',
          propertyId: 'property-1',
          status: 'ACTIVE',
          deletedAt: null,
        },
        select: { id: true },
      });
    });

    it('returns the found mandate', async () => {
      prisma.mandate.findFirst.mockResolvedValue({ id: 'mandate-1' });
      const result = await repo.findActiveByManager('m', 'p');
      expect(result).toEqual({ id: 'mandate-1' });
    });

    it('returns null when no active mandate exists', async () => {
      prisma.mandate.findFirst.mockResolvedValue(null);
      const result = await repo.findActiveByManager('m', 'p');
      expect(result).toBeNull();
    });
  });
});
