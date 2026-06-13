import { CommissionStatus, MaintenanceStatus, PaymentStatus, PropertyStatus, Role } from '@prisma/client';
import { DashboardService } from './dashboard.service';

// ─── Mock factories ───────────────────────────────────────────────────────────

function mockPrisma() {
  return {
    property: { groupBy: jest.fn().mockResolvedValue([]) },
    contract: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
    payment: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0, amountTTC: 0 }, _count: { id: 0 } }),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    tenant: {
      findFirst: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
    },
    message: { count: jest.fn().mockResolvedValue(0) },
    notification: { count: jest.fn().mockResolvedValue(0) },
    mandate: {
      findMany: jest.fn().mockResolvedValue([]),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    maintenanceRequest: {
      groupBy: jest.fn().mockResolvedValue([]),
      findMany: jest.fn().mockResolvedValue([]),
    },
    agencyMember: { findFirst: jest.fn().mockResolvedValue(null) },
    commission: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { amountHT: 0, tvaAmount: 0, amountTTC: 0 }, _count: { id: 0 } }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    user: { groupBy: jest.fn().mockResolvedValue([]) },
    agency: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

function mockCache() {
  return {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
  };
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const OWNER_ID = 'owner-1';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('DashboardService', () => {
  let service: DashboardService;
  let prisma: ReturnType<typeof mockPrisma>;
  let cache: ReturnType<typeof mockCache>;

  beforeEach(() => {
    prisma = mockPrisma();
    cache = mockCache();
    service = new DashboardService(prisma as never, cache as never);
  });

  // ── Story 9.1: getPortfolioKPIs ───────────────────────────────────────────

  describe('getPortfolioKPIs (Story 9.1)', () => {
    it('returns cached data without querying DB', async () => {
      const cached = { properties: { total: 5 }, fromCache: true };
      cache.get.mockResolvedValue(cached);

      const result = await service.getPortfolioKPIs(OWNER_ID, Role.OWNER);

      expect(result).toEqual(cached);
      expect(prisma.property.groupBy).not.toHaveBeenCalled();
    });

    it('computes and caches portfolio metrics on cache miss', async () => {
      prisma.property.groupBy.mockResolvedValue([
        { status: PropertyStatus.RENTED, _count: { id: 3 } },
        { status: PropertyStatus.AVAILABLE, _count: { id: 2 } },
      ]);
      prisma.contract.findMany.mockResolvedValue([]);

      await service.getPortfolioKPIs(OWNER_ID, Role.OWNER);

      expect(cache.set).toHaveBeenCalledWith(
        `dashboard:${OWNER_ID}:metrics`,
        expect.any(Object),
        300,
      );
    });

    it('calculates occupancy rate as RENTED/total*100', async () => {
      prisma.property.groupBy.mockResolvedValue([
        { status: PropertyStatus.RENTED, _count: { id: 4 } },
        { status: PropertyStatus.AVAILABLE, _count: { id: 6 } },
      ]);
      prisma.contract.findMany.mockResolvedValue([]);

      const result = (await service.getPortfolioKPIs(OWNER_ID, Role.OWNER)) as {
        properties: { total: number; occupancyRate: number };
      };

      expect(result.properties.total).toBe(10);
      expect(result.properties.occupancyRate).toBe(40);
    });

    it('returns contracts expiring in 30 days list', async () => {
      prisma.property.groupBy.mockResolvedValue([]);
      const expiringContract = {
        id: 'contract-1',
        endDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
        property: { id: 'prop-1', title: 'Villa Bastos' },
        tenant: { id: 'tenant-1', firstName: 'Alice', lastName: 'Ngo' },
      };
      prisma.contract.findMany.mockResolvedValue([expiringContract]);

      const result = (await service.getPortfolioKPIs(OWNER_ID, Role.OWNER)) as {
        contractsExpiring: { count: number; list: typeof expiringContract[] };
      };

      expect(result.contractsExpiring.count).toBe(1);
      expect(result.contractsExpiring.list[0].property.title).toBe('Villa Bastos');
    });

    it('includes late payment count and amount', async () => {
      prisma.property.groupBy.mockResolvedValue([]);
      prisma.contract.findMany.mockResolvedValue([]);
      prisma.payment.aggregate
        .mockResolvedValueOnce({ _sum: { amount: 500000 } }) // monthly paid
        .mockResolvedValueOnce({ _sum: { amount: 150000 }, _count: { id: 2 } }); // late

      const result = (await service.getPortfolioKPIs(OWNER_ID, Role.OWNER)) as {
        latePayments: { count: number; amount: number };
        monthlyRevenue: number;
      };

      expect(result.monthlyRevenue).toBe(500000);
      expect(result.latePayments.count).toBe(2);
      expect(result.latePayments.amount).toBe(150000);
    });
  });

  // ── Story 9.2: getMaintenanceKPIs ─────────────────────────────────────────

  describe('getMaintenanceKPIs (Story 9.2)', () => {
    it('returns open requests by urgency', async () => {
      prisma.maintenanceRequest.groupBy.mockResolvedValue([
        { urgency: 'CRITICAL', _count: { id: 2 } },
        { urgency: 'HIGH', _count: { id: 3 } },
        { urgency: 'NORMAL', _count: { id: 5 } },
      ]);

      const result = (await service.getMaintenanceKPIs(OWNER_ID, Role.OWNER)) as {
        openByUrgency: Record<string, number>;
        criticalOpen: number;
      };

      expect(result.openByUrgency.CRITICAL).toBe(2);
      expect(result.openByUrgency.HIGH).toBe(3);
      expect(result.openByUrgency.NORMAL).toBe(5);
      expect(result.openByUrgency.LOW).toBe(0);
      expect(result.criticalOpen).toBe(2);
    });

    it('calculates average resolution time in hours', async () => {
      const now = new Date();
      const createdAt = new Date(now.getTime() - 48 * 3600 * 1000); // 48h ago
      prisma.maintenanceRequest.findMany.mockResolvedValue([
        { createdAt, updatedAt: now },
        { createdAt, updatedAt: now },
      ]);

      const result = (await service.getMaintenanceKPIs(OWNER_ID, Role.OWNER)) as {
        avgResolutionHours: number;
      };

      expect(result.avgResolutionHours).toBe(48);
    });

    it('returns null avgResolutionHours when no resolved requests', async () => {
      prisma.maintenanceRequest.findMany.mockResolvedValue([]);

      const result = (await service.getMaintenanceKPIs(OWNER_ID, Role.OWNER)) as {
        avgResolutionHours: number | null;
      };

      expect(result.avgResolutionHours).toBeNull();
    });

    it('MANAGER scope uses mandated property IDs', async () => {
      prisma.mandate.findMany.mockResolvedValue([
        { propertyId: 'prop-1' },
        { propertyId: 'prop-2' },
      ]);

      await service.getMaintenanceKPIs('manager-1', Role.MANAGER);

      expect(prisma.maintenanceRequest.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            propertyId: { in: ['prop-1', 'prop-2'] },
          }),
        }),
      );
    });
  });

  // ── Story 9.3: getCommissionKPIs ──────────────────────────────────────────

  describe('getCommissionKPIs (Story 9.3)', () => {
    it('returns empty result when manager has no agency membership', async () => {
      prisma.agencyMember.findFirst.mockResolvedValue(null);

      const result = (await service.getCommissionKPIs('manager-x')) as { topOwners: unknown[] };

      expect(result.topOwners).toHaveLength(0);
    });

    it('returns cached data when available', async () => {
      prisma.agencyMember.findFirst.mockResolvedValue({ agencyId: 'agency-1' });
      cache.get.mockResolvedValue({ fromCache: true });

      const result = await service.getCommissionKPIs('manager-1');

      expect((result as { fromCache: boolean }).fromCache).toBe(true);
      expect(prisma.commission.aggregate).not.toHaveBeenCalled();
    });

    it('computes monthly paid totals (amountHT, tvaAmount, amountTTC)', async () => {
      prisma.agencyMember.findFirst.mockResolvedValue({ agencyId: 'agency-1' });
      prisma.commission.aggregate
        .mockResolvedValueOnce({ _sum: { amountHT: 100000, tvaAmount: 19250, amountTTC: 119250 } }) // monthly paid
        .mockResolvedValueOnce({ _sum: { amountTTC: 50000 }, _count: { id: 1 } }); // pending
      prisma.commission.findMany.mockResolvedValue([]);

      const result = (await service.getCommissionKPIs('manager-1')) as {
        monthlyPaid: { amountHT: number; tvaAmount: number; amountTTC: number };
      };

      expect(result.monthlyPaid.amountHT).toBe(100000);
      expect(result.monthlyPaid.tvaAmount).toBe(19250);
      expect(result.monthlyPaid.amountTTC).toBe(119250);
    });

    it('computes top 5 owners sorted by total commission volume', async () => {
      prisma.agencyMember.findFirst.mockResolvedValue({ agencyId: 'agency-1' });
      prisma.commission.findMany.mockResolvedValue([
        { type: 'MANAGEMENT', amountTTC: 200000, contract: { property: { ownerId: 'o1', owner: { firstName: 'Marc', lastName: 'A' } } } },
        { type: 'MANAGEMENT', amountTTC: 100000, contract: { property: { ownerId: 'o2', owner: { firstName: 'Jean', lastName: 'B' } } } },
        { type: 'PLACEMENT', amountTTC: 50000, contract: { property: { ownerId: 'o1', owner: { firstName: 'Marc', lastName: 'A' } } } },
      ]);

      const result = (await service.getCommissionKPIs('manager-1')) as {
        topOwners: { ownerId: string; name: string; totalTTC: number }[];
      };

      expect(result.topOwners[0].ownerId).toBe('o1');
      expect(result.topOwners[0].totalTTC).toBe(250000);
      expect(result.topOwners[1].totalTTC).toBe(100000);
    });

    it('caches result under commissions:{agencyId}:dashboard', async () => {
      prisma.agencyMember.findFirst.mockResolvedValue({ agencyId: 'agency-1' });
      prisma.commission.findMany.mockResolvedValue([]);

      await service.getCommissionKPIs('manager-1');

      expect(cache.set).toHaveBeenCalledWith('commissions:agency-1:dashboard', expect.any(Object), 300);
    });
  });

  // ── Story 9.4: getAdminKPIs ───────────────────────────────────────────────

  describe('getAdminKPIs (Story 9.4)', () => {
    it('returns users grouped by role', async () => {
      prisma.user.groupBy.mockResolvedValue([
        { role: 'OWNER', _count: { id: 10 } },
        { role: 'TENANT', _count: { id: 25 } },
        { role: 'MANAGER', _count: { id: 5 } },
      ]);
      prisma.mandate.groupBy.mockResolvedValue([]);

      const result = (await service.getAdminKPIs()) as { users: Record<string, number> };

      expect(result.users.OWNER).toBe(10);
      expect(result.users.TENANT).toBe(25);
      expect(result.users.MANAGER).toBe(5);
      expect(result.users.ADMIN).toBe(0);
    });

    it('returns top agencies by active mandates', async () => {
      prisma.mandate.groupBy.mockResolvedValue([
        { agencyId: 'agency-1', _count: { id: 8 } },
        { agencyId: 'agency-2', _count: { id: 3 } },
      ]);
      prisma.agency.findMany.mockResolvedValue([
        { id: 'agency-1', name: 'Top Agency' },
        { id: 'agency-2', name: 'Small Agency' },
      ]);

      const result = (await service.getAdminKPIs()) as {
        topAgencies: { agencyId: string; name: string; activeMandates: number }[];
      };

      expect(result.topAgencies[0].name).toBe('Top Agency');
      expect(result.topAgencies[0].activeMandates).toBe(8);
    });

    it('returns monthly platform revenue from PAID commissions', async () => {
      prisma.commission.aggregate.mockResolvedValue({
        _sum: { amountTTC: 950000 },
        _count: { id: 5 },
      });
      prisma.mandate.groupBy.mockResolvedValue([]);

      const result = (await service.getAdminKPIs()) as { monthlyPlatformRevenue: number };

      expect(result.monthlyPlatformRevenue).toBe(950000);
    });
  });

  // ── Story 9.5: getTenantDashboard ─────────────────────────────────────────

  describe('getTenantDashboard (Story 9.5)', () => {
    it('includes maintenance request counts by status', async () => {
      const tenantRecord = {
        id: 'tenant-1',
        userId: 'user-t1',
        contracts: [],
        payments: [],
      };
      prisma.tenant.findFirst.mockResolvedValue(tenantRecord);
      prisma.maintenanceRequest.groupBy.mockResolvedValue([
        { status: MaintenanceStatus.OPEN, _count: { id: 2 } },
        { status: MaintenanceStatus.IN_PROGRESS, _count: { id: 1 } },
      ]);

      const result = (await service.getTenantDashboard('user-t1')) as {
        maintenanceRequests: Record<string, number>;
      };

      expect(result.maintenanceRequests.OPEN).toBe(2);
      expect(result.maintenanceRequests.IN_PROGRESS).toBe(1);
      expect(result.maintenanceRequests.RESOLVED).toBe(0);
      expect(result.maintenanceRequests.CLOSED).toBe(0);
    });

    it('returns last 3 recent payments', async () => {
      const payments = [
        { id: 'p1', status: PaymentStatus.PAID },
        { id: 'p2', status: PaymentStatus.PAID },
        { id: 'p3', status: PaymentStatus.LATE },
      ];
      prisma.tenant.findFirst.mockResolvedValue({
        id: 'tenant-1',
        contracts: [],
        payments,
      });

      const result = (await service.getTenantDashboard('user-t1')) as {
        recentPayments: typeof payments;
      };

      expect(result.recentPayments).toHaveLength(3);
    });

    it('returns null contract and empty payments when no tenant record found', async () => {
      prisma.tenant.findFirst.mockResolvedValue(null);

      const result = (await service.getTenantDashboard('user-x')) as {
        contract: unknown;
        recentPayments: unknown[];
      };

      expect(result.contract).toBeNull();
      expect(result.recentPayments).toHaveLength(0);
    });
  });
});
