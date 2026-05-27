import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { addMonths, format, startOfMonth, endOfMonth } from 'date-fns';
import { PaymentStatus } from '@prisma/client';

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  async getOwnerStats(userId: string, role: string) {
    const propertyWhere: any = role === 'admin' ? {} : { ownerId: userId };
    const paymentPropertyWhere: any = role === 'admin' ? {} : { property: { ownerId: userId } };

    const [properties, contracts] = await Promise.all([
      this.prisma.property.groupBy({
        by: ['status'],
        where: { ...propertyWhere, deletedAt: null },
        _count: true,
      }),
      this.prisma.contract.findMany({
        where: {
          status: 'Active',
          ...(role !== 'admin' ? { property: { ownerId: userId } } : {}),
        },
        select: { id: true, endDate: true, tenantId: true },
      }),
    ]);

    const propMap = Object.fromEntries(properties.map((p) => [p.status, p._count]));
    const total = Object.values(propMap).reduce((s: number, c: any) => s + c, 0);

    const now = new Date();
    const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const expiringIn30Days = contracts.filter(
      (c) => new Date(c.endDate) >= now && new Date(c.endDate) <= in30Days,
    ).length;

    const monthStart = startOfMonth(now);
    const monthEnd = endOfMonth(now);

    const [collected, expected, late, tenants, unreadMessages, unreadNotifications] = await Promise.all([
      this.prisma.payment.aggregate({
        where: { ...paymentPropertyWhere, status: PaymentStatus.Paid, dueDate: { gte: monthStart, lte: monthEnd } },
        _sum: { amount: true },
      }),
      this.prisma.payment.aggregate({
        where: { ...paymentPropertyWhere, dueDate: { gte: monthStart, lte: monthEnd }, status: { not: PaymentStatus.Cancelled } },
        _sum: { amount: true },
      }),
      this.prisma.payment.aggregate({
        where: { ...paymentPropertyWhere, status: PaymentStatus.Late, dueDate: { gte: monthStart, lte: monthEnd } },
        _sum: { amount: true },
      }),
      this.prisma.tenant.count({ where: role !== 'admin' ? { ownerId: userId } : {} }),
      this.prisma.message.count({ where: { recipientId: userId, isRead: false } }),
      this.prisma.notification.count({ where: { userId, isRead: false } }),
    ]);

    const last12MonthsRevenue = await this.getLast12MonthsRevenue(userId, role);

    return {
      properties: {
        total,
        available: propMap['Available'] ?? 0,
        rented: propMap['Rented'] ?? 0,
        maintenance: propMap['Maintenance'] ?? 0,
        reserved: propMap['Reserved'] ?? 0,
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
          where: { status: 'Active' },
          take: 1,
          include: {
            property: {
              select: {
                title: true,
                address: true,
                images: { where: { isCover: true }, take: 1 },
              },
            },
          },
        },
        payments: { orderBy: { dueDate: 'desc' }, take: 5 },
      },
    });

    const contract = tenant?.contracts[0] ?? null;

    const nextPayment = contract
      ? await this.prisma.payment.findFirst({
          where: { contractId: contract.id, status: PaymentStatus.Pending },
          orderBy: { dueDate: 'asc' },
        })
      : null;

    const unreadMessages = await this.prisma.message.count({ where: { recipientId: userId, isRead: false } });

    return {
      contract,
      recentPayments: tenant?.payments ?? [],
      nextPayment,
      unreadMessages,
    };
  }

  async getMaintenanceRequests(userId: string, role: string, query: any) {
    const where: any = {};
    if (role === 'tenant') {
      const tenant = await this.prisma.tenant.findFirst({ where: { userId } });
      if (tenant) where.tenantId = tenant.id;
    } else if (role !== 'admin') {
      where.property = { ownerId: userId };
    }

    const requests = await this.prisma.maintenanceRequest.findMany({
      where,
      include: { property: { select: { id: true, title: true } } },
      orderBy: { createdAt: 'desc' },
    });

    return { data: requests };
  }

  async createMaintenanceRequest(userId: string, body: any) {
    const tenant = await this.prisma.tenant.findFirst({ where: { userId } });
    const request = await this.prisma.maintenanceRequest.create({
      data: {
        propertyId: body.propertyId,
        tenantId: tenant?.id,
        title: body.title,
        description: body.description,
        urgency: body.urgency,
        images: body.images ?? [],
      },
    });

    const property = await this.prisma.property.findUnique({ where: { id: body.propertyId } });
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

  async updateMaintenanceRequest(id: string, body: any) {
    return this.prisma.maintenanceRequest.update({
      where: { id },
      data: { status: body.status, comment: body.comment },
    });
  }

  private async getLast12MonthsRevenue(userId: string, role: string) {
    const result: { month: string; amount: number }[] = [];
    const now = new Date();

    for (let i = 11; i >= 0; i--) {
      const date = addMonths(now, -i);
      const start = startOfMonth(date);
      const end = endOfMonth(date);

      const agg = await this.prisma.payment.aggregate({
        where: {
          ...(role !== 'admin' ? { property: { ownerId: userId } } : {}),
          status: PaymentStatus.Paid,
          dueDate: { gte: start, lte: end },
        },
        _sum: { amount: true },
      });

      result.push({ month: format(date, 'yyyy-MM'), amount: agg._sum.amount ?? 0 });
    }

    return result;
  }
}
