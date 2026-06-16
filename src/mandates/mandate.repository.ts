import { Injectable } from '@nestjs/common';
import { Mandate, MandateStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BaseRepository, PrismaModelDelegate } from '../common/abstractions/base.repository';
import type { PaginatedResult } from '../common/interfaces/paginated-result.interface';
import type { QueryField, SearchRequest } from '../common/interfaces/search-request.interface';
import { buildMeta } from '../common/utils/pagination.util';

const MANDATE_QUERY_FIELDS: QueryField[] = [
  { filterKey: 'status',     prismaField: 'status',     filterable: true, filterType: 'exact' },
  { filterKey: 'propertyId', prismaField: 'propertyId', filterable: true, filterType: 'exact' },
  { filterKey: 'agencyId',   prismaField: 'agencyId',   filterable: true, filterType: 'exact' },
  { filterKey: 'createdAt',  prismaField: 'createdAt',  sortable: true },
];

export type MandateCreateData = {
  propertyId: string;
  agencyId: string;
  managerId: string;
  status: MandateStatus;
  startDate: Date;
  endDate?: Date | null;
  commissionType?: string | null;
  commissionValue?: number | null;
  description?: string | null;
};

const MANDATE_INCLUDE = {
  property: true,
  agency: true,
  manager: { select: { id: true, firstName: true, lastName: true, email: true } },
} as const;

@Injectable()
export class MandateRepository extends BaseRepository<Mandate, MandateCreateData> {
  constructor(private readonly prisma: PrismaService) {
    super(prisma.mandate as unknown as PrismaModelDelegate<Mandate>, MANDATE_QUERY_FIELDS);
  }

  override async findById(id: string): Promise<Mandate | null> {
    return this.prisma.mandate.findFirst({
      where: { id, deletedAt: null },
      include: MANDATE_INCLUDE,
    }) as Promise<Mandate | null>;
  }

  override async findWithPagination(
    request: SearchRequest,
    baseWhere: Record<string, unknown> = {},
  ): Promise<PaginatedResult<Mandate>> {
    const pageNumber = request.pageNumber ?? 0;
    const pageSize = request.pageSize ?? 10;
    const where = this.buildSearchWhere(request, baseWhere);
    const [data, total] = await Promise.all([
      this.prisma.mandate.findMany({
        where,
        skip: pageNumber * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: { property: true, agency: true },
      }),
      this.prisma.mandate.count({ where }),
    ]);
    return { data: data as unknown as Mandate[], meta: buildMeta(total, pageNumber, pageSize) };
  }

  override async delete(id: string): Promise<void> {
    await this.prisma.mandate.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  findActiveByManager(managerId: string, propertyId: string): Promise<{ id: string } | null> {
    return this.prisma.mandate.findFirst({
      where: { managerId, propertyId, status: MandateStatus.ACTIVE, deletedAt: null },
      select: { id: true },
    });
  }

  findDuplicate(propertyId: string, agencyId: string, managerId: string): Promise<{ id: string } | null> {
    return this.prisma.mandate.findFirst({
      where: { propertyId, agencyId, managerId, status: MandateStatus.ACTIVE, deletedAt: null },
      select: { id: true },
    });
  }

  updateStatus(id: string, status: MandateStatus): Promise<Mandate> {
    return this.prisma.mandate.update({
      where: { id },
      data: { status },
      include: MANDATE_INCLUDE,
    }) as Promise<Mandate>;
  }
}
