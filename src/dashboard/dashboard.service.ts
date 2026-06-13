import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import { addMonths, endOfMonth, format, startOfMonth } from 'date-fns';
import {
  CommissionStatus,
  ContractStatus,
  MandateStatus,
  MaintenanceStatus,
  PaymentStatus,
  PropertyStatus,
  Role,
} from '@prisma/client';

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  // ── Existing (preserved) ─────────────────────────────────────────────────────

  async getOwnerStats(userId: string, role: string) {
    const propertyWhere: Record<string, unknown> = role === Role.ADMIN ? {} : { ownerId: userId };
    const paymentPropertyWhere: Record<string, unknown> =
      role === Role.ADMIN ? {} : { property: { ownerId: userId } };

    const [properties, contracts] = await Promise.all([
      this.prisma.property.groupBy({
        by: ['status'],
        where: { ...propertyWhere, deletedAt: null } as never,
        _count: true,
      }),
      this.prisma.contract.findMany({
        where: {
          status: ContractStatus.ACTIVE,
          ...(role !== Role.ADMIN ? { property: { ownerId: userId } } : {}),
        },
        select: { id: true, endDate: true, tenantId: true },
      }),
    ]);

    const propMap = Object.fromEntries(properties.map((p) => [p.status, p._count]));
    const total = Object.values(propMap).reduce((s: number, c: unknown) => s + (c as number), 0);

    const now = new Date();
    const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const expiringIn30Days = contracts.filter(
      (c) => new Date(c.endDate) >= now && new Date(c.endDate) <= in30Days,
    ).length;

    const monthStart = startOfMonth(now);
    const monthEnd = endOfMonth(now);

    const [collected, expected, late, tenants, unreadMessages, unreadNotifications] =
      await Promise.all([
        this.prisma.payment.aggregate({
          where: {
            ...paymentPropertyWhere,
            status: PaymentStatus.PAID,
            dueDate: { gte: monthStart, lte: monthEnd },
          } as never,
          _sum: { amount: true },
        }),
        this.prisma.payment.aggregate({
          where: {
            ...paymentPropertyWhere,
            dueDate: { gte: monthStart, lte: monthEnd },
            status: { not: PaymentStatus.CANCELLED },
          } as never,
          _sum: { amount: true },
        }),
        this.prisma.payment.aggregate({
          where: {
            ...paymentPropertyWhere,
            status: PaymentStatus.LATE,
            dueDate: { gte: monthStart, lte: monthEnd },
          } as never,
          _sum: { amount: true },
        }),
        this.prisma.tenant.count({ where: role !== Role.ADMIN ? { ownerId: userId } : {} }),
        this.prisma.message.count({ where: { recipientId: userId, isRead: false } }),
        this.prisma.notification.count({ where: { userId, isRead: false } }),
      ]);

    const last12MonthsRevenue = await this.getLast12MonthsRevenue(userId, role);

    return {
      properties: {
        total,
        available: propMap[PropertyStatus.AVAILABLE] ?? 0,
        rented: propMap[PropertyStatus.RENTED] ?? 0,
        maintenance: propMap[PropertyStatus.MAINTENANCE] ?? 0,
        reserved: propMap[PropertyStatus.RESERVED] ?? 0,
      },
      monthlyPayments: {
        collected: collected._sum.amount ?? 0,
        expected: expected._sum.amount ?? 0,
        late: late._sum.amount ?? 0,
      },
      contracts: { active: contracts.length, expiringIn30Days },
      tenants: { total: tenants },
      unreadMessages,
      unreadNotifications,
      last12MonthsRevenue,
    };
  }

  async getTenantDashboard(userId: string) {
    const tenant = await this.prisma.tenant.findFirst({
      where: { userId },
      include: {
        contracts: {
          where: { status: ContractStatus.ACTIVE },
          take: 1,
          include: {
            property: {
              select: {
                title: true,
                address: true,
                city: true,
                images: { where: { isCover: true }, take: 1 },
              },
            },
          },
        },
        payments: { orderBy: { dueDate: 'desc' }, take: 3 },
      },
    });

    const contract = tenant?.contracts[0] ?? null;

    const [nextPayment, unreadMessages, maintenanceCounts] = await Promise.all([
      contract
        ? this.prisma.payment.findFirst({
            where: {
              contractId: contract.id,
              status: { in: [PaymentStatus.PENDING, PaymentStatus.LATE] },
            },
            orderBy: { dueDate: 'asc' },
          })
        : Promise.resolve(null),
      this.prisma.message.count({ where: { recipientId: userId, isRead: false } }),
      tenant
        ? this.prisma.maintenanceRequest.groupBy({
            by: ['status'],
            where: { tenantId: tenant.id },
            _count: { id: true },
          })
        : Promise.resolve([]),
    ]);

    const maintenanceMap: Record<string, number> = {};
    for (const m of maintenanceCounts) maintenanceMap[m.status] = m._count.id;

    return {
      contract,
      recentPayments: tenant?.payments ?? [],
      nextPayment,
      unreadMessages,
      maintenanceRequests: {
        OPEN: maintenanceMap[MaintenanceStatus.OPEN] ?? 0,
        IN_PROGRESS: maintenanceMap[MaintenanceStatus.IN_PROGRESS] ?? 0,
        RESOLVED: maintenanceMap[MaintenanceStatus.RESOLVED] ?? 0,
        CLOSED: maintenanceMap[MaintenanceStatus.CLOSED] ?? 0,
      },
    };
  }

  async getMaintenanceRequests(userId: string, role: string, query: Record<string, unknown>) {
    const where: Record<string, unknown> = {};
    if (role === Role.TENANT) {
      const tenant = await this.prisma.tenant.findFirst({ where: { userId } });
      if (tenant) where.tenantId = tenant.id;
    } else if (role !== Role.ADMIN) {
      where.property = { ownerId: userId };
    }

    const requests = await this.prisma.maintenanceRequest.findMany({
      where: where as never,
      include: { property: { select: { id: true, title: true } } },
      orderBy: { createdAt: 'desc' },
    });

    return { data: requests };
  }

  async createMaintenanceRequest(userId: string, body: Record<string, unknown>) {
    const tenant = await this.prisma.tenant.findFirst({ where: { userId } });
    const request = await this.prisma.maintenanceRequest.create({
      data: {
        propertyId: body.propertyId as string,
        tenantId: tenant?.id,
        title: body.title as string,
        description: body.description as string,
        urgency: body.urgency as never,
        images: (body.images as string[]) ?? [],
      },
    });

    const property = await this.prisma.property.findUnique({
      where: { id: body.propertyId as string },
    });
    if (property) {
      await this.prisma.notification.create({
        data: {
          userId: property.ownerId,
          type: 'maintenance_reported',
          title: 'Problème signalé',
          body: `Un problème a été signalé : "${body.title}"`,
        },
      });
    }

    return request;
  }

  async updateMaintenanceRequest(id: string, body: Record<string, unknown>) {
    return this.prisma.maintenanceRequest.update({
      where: { id },
      data: { status: body.status as never, comment: body.comment as string | undefined },
    });
  }

  // ── Story 9.1: Portfolio KPIs ─────────────────────────────────────────────

  async getPortfolioKPIs(userId: string, role: string): Promise<unknown> {
    const cacheKey = `dashboard:${userId}:metrics`;
    const cached = await this.cache.get<unknown>(cacheKey);
    if (cached) return cached;

    const propWhere =
      role === Role.ADMIN
        ? { deletedAt: null }
        : { ownerId: userId, deletedAt: null };
    const payWhere =
      role === Role.ADMIN
        ? {}
        : { property: { ownerId: userId } };
    const contractWhere =
      role === Role.ADMIN
        ? { status: ContractStatus.ACTIVE }
        : { status: ContractStatus.ACTIVE, property: { ownerId: userId } };

    if (role === Role.MANAGER) {
      const mandates = await this.prisma.mandate.findMany({
        where: { managerId: userId, status: MandateStatus.ACTIVE, deletedAt: null },
        select: { propertyId: true },
      });
      const ids = mandates.map((m) => m.propertyId);
      (propWhere as Record<string, unknown>).id = { in: ids };
      (payWhere as Record<string, unknown>).propertyId = { in: ids };
      (contractWhere as Record<string, unknown>).propertyId = { in: ids };
      delete (propWhere as Record<string, unknown>).ownerId;
      delete (contractWhere as Record<string, unknown>).property;
      delete (payWhere as Record<string, unknown>).property;
    }

    const now = new Date();
    const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const monthStart = startOfMonth(now);
    const monthEnd = endOfMonth(now);

    const [propsByStatus, expiringContracts, monthlyPaid, latePayments] = await Promise.all([
      this.prisma.property.groupBy({
        by: ['status'],
        where: propWhere as never,
        _count: { id: true },
      }),
      this.prisma.contract.findMany({
        where: {
          ...contractWhere,
          endDate: { gte: now, lte: in30Days },
        } as never,
        select: {
          id: true,
          endDate: true,
          property: { select: { id: true, title: true } },
          tenant: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      this.prisma.payment.aggregate({
        where: {
          ...payWhere,
          status: PaymentStatus.PAID,
          dueDate: { gte: monthStart, lte: monthEnd },
        } as never,
        _sum: { amount: true },
      }),
      this.prisma.payment.aggregate({
        where: { ...payWhere, status: PaymentStatus.LATE } as never,
        _sum: { amount: true },
        _count: { id: true },
      }),
    ]);

    const propMap: Record<string, number> = {};
    let totalProps = 0;
    for (const p of propsByStatus) {
      propMap[p.status] = p._count.id;
      totalProps += p._count.id;
    }
    const rented = propMap[PropertyStatus.RENTED] ?? 0;
    const occupancyRate = totalProps > 0 ? Math.round((rented / totalProps) * 1000) / 10 : 0;

    const result = {
      properties: {
        total: totalProps,
        byStatus: propMap,
        occupancyRate,
      },
      monthlyRevenue: monthlyPaid._sum.amount ?? 0,
      latePayments: {
        count: latePayments._count.id,
        amount: latePayments._sum.amount ?? 0,
      },
      contractsExpiring: {
        count: expiringContracts.length,
        list: expiringContracts,
      },
    };

    await this.cache.set(cacheKey, result, 300);
    return result;
  }

  // ── Story 9.2: Maintenance KPIs ───────────────────────────────────────────

  async getMaintenanceKPIs(userId: string, role: string): Promise<unknown> {
    const where: Record<string, unknown> = {};

    if (role === Role.OWNER) {
      where.property = { ownerId: userId };
    } else if (role === Role.MANAGER) {
      const mandates = await this.prisma.mandate.findMany({
        where: { managerId: userId, status: MandateStatus.ACTIVE, deletedAt: null },
        select: { propertyId: true },
      });
      where.propertyId = { in: mandates.map((m) => m.propertyId) };
    }
    // ADMIN: no scope filter

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [openByUrgency, resolvedRecent] = await Promise.all([
      this.prisma.maintenanceRequest.groupBy({
        by: ['urgency'],
        where: { ...where, status: MaintenanceStatus.OPEN } as never,
        _count: { id: true },
      }),
      this.prisma.maintenanceRequest.findMany({
        where: {
          ...where,
          status: { in: [MaintenanceStatus.RESOLVED, MaintenanceStatus.CLOSED] },
          updatedAt: { gte: thirtyDaysAgo },
        } as never,
        select: { createdAt: true, updatedAt: true },
      }),
    ]);

    const urgencyMap: Record<string, number> = {};
    for (const u of openByUrgency) urgencyMap[u.urgency] = u._count.id;

    let avgResolutionHours: number | null = null;
    if (resolvedRecent.length > 0) {
      const totalMs = resolvedRecent.reduce(
        (sum, r) => sum + (r.updatedAt.getTime() - r.createdAt.getTime()),
        0,
      );
      avgResolutionHours = Math.round((totalMs / resolvedRecent.length / (1000 * 3600)) * 10) / 10;
    }

    return {
      openByUrgency: {
        LOW: urgencyMap['LOW'] ?? 0,
        NORMAL: urgencyMap['NORMAL'] ?? 0,
        HIGH: urgencyMap['HIGH'] ?? 0,
        CRITICAL: urgencyMap['CRITICAL'] ?? 0,
      },
      criticalOpen: urgencyMap['CRITICAL'] ?? 0,
      avgResolutionHours,
    };
  }

  // ── Story 9.3: Commission KPIs (MANAGER) ─────────────────────────────────

  async getCommissionKPIs(userId: string): Promise<unknown> {
    const membership = await this.prisma.agencyMember.findFirst({
      where: { userId },
      select: { agencyId: true },
    });
    if (!membership) return { monthlyPaid: null, pending: null, byType: {}, topOwners: [] };

    const agencyId = membership.agencyId;
    const cacheKey = `commissions:${agencyId}:dashboard`;
    const cached = await this.cache.get<unknown>(cacheKey);
    if (cached) return cached;

    const now = new Date();
    const monthStart = startOfMonth(now);
    const monthEnd = endOfMonth(now);

    const [monthlyPaidAgg, pendingAgg, allCommissions] = await Promise.all([
      this.prisma.commission.aggregate({
        where: {
          agencyId,
          status: CommissionStatus.PAID,
          paidAt: { gte: monthStart, lte: monthEnd },
        },
        _sum: { amountHT: true, tvaAmount: true, amountTTC: true },
      }),
      this.prisma.commission.aggregate({
        where: { agencyId, status: CommissionStatus.PENDING },
        _sum: { amountTTC: true },
        _count: { id: true },
      }),
      this.prisma.commission.findMany({
        where: { agencyId },
        select: {
          type: true,
          amountTTC: true,
          contract: {
            select: {
              property: {
                select: {
                  ownerId: true,
                  owner: { select: { firstName: true, lastName: true } },
                },
              },
            },
          },
        },
      }),
    ]);

    const byTypeMap: Record<string, number> = {};
    const ownerMap: Record<string, { name: string; total: number }> = {};

    for (const c of allCommissions) {
      byTypeMap[c.type] = (byTypeMap[c.type] ?? 0) + c.amountTTC;
      const prop = (c.contract as { property?: { ownerId?: string; owner?: { firstName: string; lastName: string } } })?.property;
      const ownerId = prop?.ownerId;
      if (ownerId) {
        if (!ownerMap[ownerId]) {
          ownerMap[ownerId] = {
            name: prop?.owner ? `${prop.owner.firstName} ${prop.owner.lastName}` : ownerId,
            total: 0,
          };
        }
        ownerMap[ownerId].total += c.amountTTC;
      }
    }

    const topOwners = Object.entries(ownerMap)
      .map(([ownerId, { name, total }]) => ({ ownerId, name, totalTTC: total }))
      .sort((a, b) => b.totalTTC - a.totalTTC)
      .slice(0, 5);

    const result = {
      monthlyPaid: {
        amountHT: monthlyPaidAgg._sum.amountHT ?? 0,
        tvaAmount: monthlyPaidAgg._sum.tvaAmount ?? 0,
        amountTTC: monthlyPaidAgg._sum.amountTTC ?? 0,
      },
      pending: {
        count: pendingAgg._count.id,
        amountTTC: pendingAgg._sum.amountTTC ?? 0,
      },
      byType: byTypeMap,
      topOwners,
    };

    await this.cache.set(cacheKey, result, 300);
    return result;
  }

  // ── Story 9.4: Admin platform KPIs ───────────────────────────────────────

  async getAdminKPIs(): Promise<unknown> {
    const now = new Date();
    const monthStart = startOfMonth(now);
    const monthEnd = endOfMonth(now);

    const [
      usersByRole,
      propsByStatus,
      activeContracts,
      latePayments,
      monthlyCommissions,
      topAgenciesRaw,
    ] = await Promise.all([
      this.prisma.user.groupBy({
        by: ['role'],
        where: { isActive: true },
        _count: { id: true },
      }),
      this.prisma.property.groupBy({
        by: ['status'],
        where: { deletedAt: null },
        _count: { id: true },
      }),
      this.prisma.contract.count({ where: { status: ContractStatus.ACTIVE } }),
      this.prisma.payment.aggregate({
        where: { status: PaymentStatus.LATE },
        _count: { id: true },
        _sum: { amount: true },
      }),
      this.prisma.commission.aggregate({
        where: {
          status: CommissionStatus.PAID,
          paidAt: { gte: monthStart, lte: monthEnd },
        },
        _sum: { amountTTC: true },
      }),
      this.prisma.mandate.groupBy({
        by: ['agencyId'],
        where: { status: MandateStatus.ACTIVE, deletedAt: null },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 5,
      }),
    ]);

    const agencyIds = topAgenciesRaw.map((a) => a.agencyId);
    const agencies = await this.prisma.agency.findMany({
      where: { id: { in: agencyIds } },
      select: { id: true, name: true },
    });
    const agencyNameMap = Object.fromEntries(agencies.map((a) => [a.id, a.name]));

    const roleMap: Record<string, number> = {};
    for (const u of usersByRole) roleMap[u.role] = u._count.id;

    const propMap: Record<string, number> = {};
    let totalProps = 0;
    for (const p of propsByStatus) {
      propMap[p.status] = p._count.id;
      totalProps += p._count.id;
    }

    return {
      users: {
        OWNER: roleMap['OWNER'] ?? 0,
        MANAGER: roleMap['MANAGER'] ?? 0,
        TENANT: roleMap['TENANT'] ?? 0,
        ADMIN: roleMap['ADMIN'] ?? 0,
      },
      properties: { total: totalProps, byStatus: propMap },
      contracts: { active: activeContracts },
      latePayments: {
        count: latePayments._count.id,
        amount: latePayments._sum.amount ?? 0,
      },
      monthlyPlatformRevenue: monthlyCommissions._sum.amountTTC ?? 0,
      topAgencies: topAgenciesRaw.map((a) => ({
        agencyId: a.agencyId,
        name: agencyNameMap[a.agencyId] ?? a.agencyId,
        activeMandates: a._count.id,
      })),
    };
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async getLast12MonthsRevenue(userId: string, role: string) {
    const result: { month: string; amount: number }[] = [];
    const now = new Date();

    for (let i = 11; i >= 0; i--) {
      const date = addMonths(now, -i);
      const start = startOfMonth(date);
      const end = endOfMonth(date);

      const agg = await this.prisma.payment.aggregate({
        where: {
          ...(role !== Role.ADMIN ? { property: { ownerId: userId } } : {}),
          status: PaymentStatus.PAID,
          dueDate: { gte: start, lte: end },
        } as never,
        _sum: { amount: true },
      });

      result.push({ month: format(date, 'yyyy-MM'), amount: agg._sum.amount ?? 0 });
    }

    return result;
  }
}
