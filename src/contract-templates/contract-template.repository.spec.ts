import { ContractTemplateRepository } from './contract-template.repository';

// ─── Mock ─────────────────────────────────────────────────────────────────────

function mockPrisma() {
  return {
    contractTemplate: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ContractTemplateRepository', () => {
  let repo: ContractTemplateRepository;
  let prisma: ReturnType<typeof mockPrisma>;

  beforeEach(() => {
    prisma = mockPrisma();
    repo = new ContractTemplateRepository(prisma as never);
  });

  describe('findWithPagination', () => {
    it('cannot be overridden by a client-supplied agencyId filter (IDOR regression guard)', async () => {
      await repo.findWithPagination(
        {
          pageNumber: 0,
          pageSize: 10,
          filters: { agencyId: ['attacker-agency'] },
        },
        { agencyId: 'caller-agency' },
      );

      const [findManyArg] = prisma.contractTemplate.findMany.mock.calls[0] as [
        { where: { agencyId: string } },
      ];
      expect(findManyArg.where.agencyId).toBe('caller-agency');
    });

    it('filters by name via search', async () => {
      await repo.findWithPagination(
        { pageNumber: 0, pageSize: 10, searchKey: 'Bail' },
        { agencyId: 'caller-agency' },
      );

      const [findManyArg] = prisma.contractTemplate.findMany.mock.calls[0] as [
        { where: { OR?: unknown[] } },
      ];
      expect(findManyArg.where.OR).toBeDefined();
    });
  });
});
