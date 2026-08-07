import { NotFoundException } from '@nestjs/common';
import { ContractSection, Role } from '@prisma/client';
import { ContractTemplatesService } from './contract-templates.service';

// ─── Mock factories ───────────────────────────────────────────────────────────

function mockTx() {
  return {
    contractTemplateClause: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    contractTemplate: {
      update: jest.fn(),
    },
    contract: {
      findMany: jest.fn(),
      update: jest.fn(),
    },
  };
}

function mockPrisma() {
  const tx = mockTx();
  return {
    agencyMember: {
      findFirst: jest.fn(),
    },
    $transaction: jest.fn((cb: (tx: ReturnType<typeof mockTx>) => unknown) =>
      cb(tx),
    ),
    tx,
  };
}

function mockRepository() {
  return {
    create: jest.fn(),
    findById: jest.fn(),
    findByIdOrThrow: jest.fn(),
    findWithPagination: jest.fn(),
  };
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TEMPLATE_STUB = {
  id: 'template-1',
  agencyId: 'agency-1',
  name: 'Bail standard',
  lockedSections: [ContractSection.RENT, ContractSection.DURATION],
  clauses: [
    { id: 'clause-1', templateId: 'template-1', text: 'Clause A', order: 0 },
  ],
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ContractTemplatesService', () => {
  let service: ContractTemplatesService;
  let repository: ReturnType<typeof mockRepository>;
  let prisma: ReturnType<typeof mockPrisma>;

  beforeEach(() => {
    repository = mockRepository();
    prisma = mockPrisma();
    service = new ContractTemplatesService(
      repository as never,
      prisma as never,
    );
  });

  // ── createTemplate ──────────────────────────────────────────────────────

  describe('createTemplate', () => {
    beforeEach(() => {
      prisma.agencyMember.findFirst.mockResolvedValue({ agencyId: 'agency-1' });
      repository.create.mockResolvedValue(TEMPLATE_STUB);
    });

    it('resolves the agency from the manager membership and creates the template with nested clauses', async () => {
      const result = await service.createTemplate('manager-1', {
        name: 'Bail standard',
        lockedSections: [ContractSection.RENT],
        clauses: ['Clause A', 'Clause B'],
      });

      expect(prisma.agencyMember.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'manager-1' } }),
      );
      expect(repository.create).toHaveBeenCalledWith({
        agencyId: 'agency-1',
        name: 'Bail standard',
        lockedSections: [ContractSection.RENT],
        clauses: {
          create: [
            { text: 'Clause A', order: 0 },
            { text: 'Clause B', order: 1 },
          ],
        },
      });
      expect(result).toEqual(TEMPLATE_STUB);
    });

    it('defaults lockedSections and clauses to empty when omitted', async () => {
      await service.createTemplate('manager-1', { name: 'Bail minimal' });

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          lockedSections: [],
          clauses: { create: [] },
        }),
      );
    });

    it('throws ForbiddenException when the manager has no agency', async () => {
      prisma.agencyMember.findFirst.mockResolvedValue(null);

      await expect(
        service.createTemplate('manager-1', { name: 'Bail standard' }),
      ).rejects.toThrow(
        'Vous devez appartenir à une agence pour créer un modèle de contrat',
      );
      expect(repository.create).not.toHaveBeenCalled();
    });
  });

  // ── search ───────────────────────────────────────────────────────────────

  describe('search', () => {
    it('scopes the search to the manager agency', async () => {
      prisma.agencyMember.findFirst.mockResolvedValue({ agencyId: 'agency-1' });
      repository.findWithPagination.mockResolvedValue({
        data: [TEMPLATE_STUB],
        meta: { total: 1, pageNumber: 0, pageSize: 10, totalPages: 1 },
      });

      await service.search('manager-1', Role.MANAGER, {});

      expect(repository.findWithPagination).toHaveBeenCalledWith(
        {},
        { agencyId: 'agency-1' },
      );
    });

    it('does not scope the search for ADMIN', async () => {
      repository.findWithPagination.mockResolvedValue({
        data: [],
        meta: { total: 0, pageNumber: 0, pageSize: 10, totalPages: 0 },
      });

      await service.search('admin-1', Role.ADMIN, {});

      expect(prisma.agencyMember.findFirst).not.toHaveBeenCalled();
      expect(repository.findWithPagination).toHaveBeenCalledWith({}, {});
    });

    it('returns an empty result instead of throwing for a caller with no agency membership (e.g. OWNER)', async () => {
      prisma.agencyMember.findFirst.mockResolvedValue(null);

      const result = await service.search('owner-1', Role.OWNER, {
        pageNumber: 1,
        pageSize: 5,
      });

      expect(repository.findWithPagination).not.toHaveBeenCalled();
      expect(result).toEqual({
        data: [],
        meta: { total: 0, pageNumber: 1, pageSize: 5, totalPages: 0 },
      });
    });
  });

  // ── getOneScoped ─────────────────────────────────────────────────────────

  describe('getOneScoped', () => {
    it('returns the template when it belongs to the caller agency', async () => {
      repository.findById.mockResolvedValue(TEMPLATE_STUB);
      prisma.agencyMember.findFirst.mockResolvedValue({ agencyId: 'agency-1' });

      const result = await service.getOneScoped(
        'template-1',
        'manager-1',
        Role.MANAGER,
      );

      expect(result).toEqual(TEMPLATE_STUB);
    });

    it('throws NotFoundException when the template does not exist', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(
        service.getOneScoped('unknown', 'manager-1', Role.MANAGER),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when the template belongs to a different agency (cross-tenant read blocked)', async () => {
      repository.findById.mockResolvedValue(TEMPLATE_STUB);
      prisma.agencyMember.findFirst.mockResolvedValue({ agencyId: 'agency-2' });

      await expect(
        service.getOneScoped('template-1', 'manager-1', Role.MANAGER),
      ).rejects.toThrow("Ce modèle n'appartient pas à votre agence");
    });

    it('allows ADMIN to read a template regardless of agency', async () => {
      repository.findById.mockResolvedValue(TEMPLATE_STUB);

      const result = await service.getOneScoped(
        'template-1',
        'admin-1',
        Role.ADMIN,
      );

      expect(prisma.agencyMember.findFirst).not.toHaveBeenCalled();
      expect(result).toEqual(TEMPLATE_STUB);
    });
  });

  // ── updateTemplate ──────────────────────────────────────────────────────

  describe('updateTemplate', () => {
    beforeEach(() => {
      repository.findById.mockResolvedValue(TEMPLATE_STUB);
      prisma.agencyMember.findFirst.mockResolvedValue({ agencyId: 'agency-1' });
      prisma.tx.contractTemplate.update.mockResolvedValue({
        ...TEMPLATE_STUB,
        name: 'Bail révisé',
      });
    });

    it('updates the template when the manager belongs to the same agency', async () => {
      const result = await service.updateTemplate(
        'template-1',
        'manager-1',
        Role.MANAGER,
        { name: 'Bail révisé' },
      );

      expect(prisma.tx.contractTemplate.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'template-1' },
          data: { name: 'Bail révisé' },
        }),
      );
      expect(result.name).toBe('Bail révisé');
    });

    it('replaces clauses when clauses are provided', async () => {
      await service.updateTemplate('template-1', 'manager-1', Role.MANAGER, {
        clauses: ['New clause'],
      });

      expect(prisma.tx.contractTemplateClause.deleteMany).toHaveBeenCalledWith({
        where: { templateId: 'template-1' },
      });
      expect(prisma.tx.contractTemplate.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { clauses: { create: [{ text: 'New clause', order: 0 }] } },
        }),
      );
    });

    it('throws NotFoundException when the template does not exist', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(
        service.updateTemplate('unknown', 'manager-1', Role.MANAGER, {
          name: 'x',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when the template belongs to a different agency', async () => {
      prisma.agencyMember.findFirst.mockResolvedValue({ agencyId: 'agency-2' });

      await expect(
        service.updateTemplate('template-1', 'manager-1', Role.MANAGER, {
          name: 'x',
        }),
      ).rejects.toThrow("Ce modèle n'appartient pas à votre agence");
    });

    it('allows ADMIN to update a template regardless of agency', async () => {
      const result = await service.updateTemplate(
        'template-1',
        'admin-1',
        Role.ADMIN,
        { name: 'Bail révisé' },
      );

      expect(prisma.agencyMember.findFirst).not.toHaveBeenCalled();
      expect(result.name).toBe('Bail révisé');
    });

    it('never touches an existing Contract/ContractClause row (AC#3 — immutability by construction)', async () => {
      await service.updateTemplate('template-1', 'manager-1', Role.MANAGER, {
        name: 'Bail révisé',
        lockedSections: [ContractSection.PARTIES],
        clauses: ['New clause'],
      });

      expect(prisma.tx.contract.findMany).not.toHaveBeenCalled();
      expect(prisma.tx.contract.update).not.toHaveBeenCalled();
    });
  });
});
