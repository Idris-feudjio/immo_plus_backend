import { Injectable } from '@nestjs/common';
import { Commission, CommissionCategory, CommissionStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BaseRepository, PrismaModelDelegate } from '../common/abstractions/base.repository';
import type { PaginatedResult } from '../common/interfaces/paginated-result.interface';
import type { QueryField, SearchRequest } from '../common/interfaces/search-request.interface';
import { buildMeta } from '../common/utils/pagination.util';

const COMMISSION_QUERY_FIELDS: QueryField[] = [
  { filterKey: 'status',     prismaField: 'status',     filterable: true, filterType: 'exact' },
  { filterKey: 'type',       prismaField: 'type',       filterable: true, filterType: 'exact' },
  { filterKey: 'agencyId',   prismaField: 'agencyId',   filterable: true, filterType: 'exact' },
  { filterKey: 'contractId', prismaField: 'contractId', filterable: true, filterType: 'exact' },
  { filterKey: 'createdAt',  prismaField: 'createdAt',  sortable: true, filterable: true, filterType: 'date-range' },
];

export type CommissionCreateData = {
  contractId: string;
  agencyId: string;
  mandateId?: string | null;
  type: CommissionCategory;
  amountHT: number;
  tvaRate: number;
  tvaAmount: number;
  amountTTC: number;
  description?: string | null;
  status?: CommissionStatus;
  paidAt?: Date | null;
  paymentMethod?: string | null;
  reference?: string | null;
  receiptUrl?: string | null;
};

const COMMISSION_DETAIL_INCLUDE = {
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
} as const;

const COMMISSION_LIST_INCLUDE = {
  agency: true,
  mandate: true,
  contract: { include: { property: true } },
} as const;

@Injectable()
export class CommissionRepository extends BaseRepository<Commission, CommissionCreateData> {
  constructor(private readonly prisma: PrismaService) {
    super(prisma.commission as unknown as PrismaModelDelegate<Commission>, COMMISSION_QUERY_FIELDS);
  }

  override async findById(id: string): Promise<Commission | null> {
    return this.prisma.commission.findUnique({
      where: { id },
      include: COMMISSION_DETAIL_INCLUDE,
    }) as Promise<Commission | null>;
  }

  override async findWithPagination(
    request: SearchRequest,
    baseWhere: Record<string, unknown> = {},
  ): Promise<PaginatedResult<Commission>> {
    const pageNumber = request.pageNumber ?? 0;
    const pageSize = request.pageSize ?? 10;
    const where = this.buildSearchWhere(request, baseWhere);
    const [data, total] = await Promise.all([
      this.prisma.commission.findMany({
        where,
        skip: pageNumber * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: COMMISSION_LIST_INCLUDE,
      }),
      this.prisma.commission.count({ where }),
    ]);
    return { data: data as unknown as Commission[], meta: buildMeta(total, pageNumber, pageSize) };
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
      where: { contract: { property: { ownerId: userId } } },
      include: {
        agency: { select: { id: true, name: true } },
        contract: { select: { id: true, propertyId: true } },
      },
      orderBy: { createdAt: 'desc' },
    }) as Promise<Commission[]>;
  }
}
