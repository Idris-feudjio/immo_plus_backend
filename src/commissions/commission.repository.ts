import { Injectable } from '@nestjs/common';
import { Commission, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { PaginatedResult } from '../common/interfaces/paginated-result.interface';

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

  async findPaginated(
    baseWhere: Prisma.CommissionWhereInput,
    page: number,
    limit: number,
  ): Promise<PaginatedResult<Commission>> {
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.commission.findMany({
        where: baseWhere,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          agency: true,
          mandate: true,
          contract: { include: { property: true } },
        },
      }),
      this.prisma.commission.count({ where: baseWhere }),
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
