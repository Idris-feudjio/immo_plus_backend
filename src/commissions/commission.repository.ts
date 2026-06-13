import { Injectable } from '@nestjs/common';
import { Commission, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { PaginatedResult } from '../common/interfaces/paginated-result.interface';
import type { FilterCommissionsDto } from './dto/commission.dto';

@Injectable()
export class CommissionRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string): Promise<Commission | null> {
    return this.prisma.commission.findUnique({
      where: { id },
      include: {
        mandate: {
          select: {
            id: true,
            managerId: true,
            manager: { select: { id: true, email: true, firstName: true, lastName: true } },
          },
        },
        agency: { select: { id: true, name: true, address: true } },
        contract: {
          select: {
            id: true,
            propertyId: true,
            property: {
              select: {
                id: true,
                title: true,
                address: true,
                city: true,
                ownerId: true,
                owner: { select: { id: true, email: true, firstName: true, lastName: true } },
              },
            },
          },
        },
      },
    }) as Promise<Commission | null>;
  }

  create(data: Prisma.CommissionUncheckedCreateInput): Promise<Commission> {
    return this.prisma.commission.create({ data });
  }

  update(id: string, data: Prisma.CommissionUncheckedUpdateInput): Promise<Commission> {
    return this.prisma.commission.update({ where: { id }, data });
  }

  async findListPaginated(
    userId: string,
    role: string,
    query: FilterCommissionsDto,
  ): Promise<PaginatedResult<Commission>> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 10));
    const skip = (page - 1) * limit;

    const where: Prisma.CommissionWhereInput = {};

    if (role === Role.MANAGER) {
      const memberships = await this.prisma.agencyMember.findMany({
        where: { userId },
        select: { agencyId: true },
      });
      where.agencyId = { in: memberships.map((m) => m.agencyId) };
    }

    if (query.status) where.status = query.status;
    if (query.type) where.type = query.type;
    if (query.agencyId) where.agencyId = query.agencyId;
    if (query.contractId) where.contractId = query.contractId;
    if (query.dateFrom || query.dateTo) {
      const dateFilter: Prisma.DateTimeFilter = {};
      if (query.dateFrom) dateFilter.gte = new Date(query.dateFrom);
      if (query.dateTo) dateFilter.lte = new Date(query.dateTo);
      where.createdAt = dateFilter;
    }

    const [data, total] = await Promise.all([
      this.prisma.commission.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          agency: true,
          mandate: true,
          contract: { include: { property: true } },
        },
      }),
      this.prisma.commission.count({ where }),
    ]);

    return {
      data: data as Commission[],
      meta: {
        total,
        pageNumber: page - 1,
        pageSize: limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getDashboardStats(agencyId: string | null): Promise<Record<string, unknown>> {
    const where: Prisma.CommissionWhereInput = agencyId ? { agencyId } : {};

    const [byStatus, byType] = await Promise.all([
      this.prisma.commission.groupBy({
        by: ['status'],
        where,
        _count: { id: true },
        _sum: { amountHT: true, amountTTC: true },
      }),
      this.prisma.commission.groupBy({
        by: ['type'],
        where,
        _count: { id: true },
        _sum: { amountTTC: true },
      }),
    ]);

    return { byStatus, byType };
  }

  getOwnerDue(userId: string): Promise<Commission[]> {
    return this.prisma.commission.findMany({
      where: {
        contract: { property: { ownerId: userId } },
      },
      include: {
        agency: { select: { id: true, name: true } },
        contract: { select: { id: true, propertyId: true } },
      },
      orderBy: { createdAt: 'desc' },
    }) as Promise<Commission[]>;
  }
}
