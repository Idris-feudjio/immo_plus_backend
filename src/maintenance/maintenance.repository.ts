import { Injectable } from '@nestjs/common';
import { MaintenanceRequest, MaintenanceUrgency } from '@prisma/client';
import { BaseRepository, PrismaModelDelegate } from '../common/abstractions/base.repository';
import type { PaginatedResult } from '../common/interfaces/paginated-result.interface';
import type { QueryField, ISearchRequest } from '../common/interfaces/search-request.interface';
import { buildMeta } from '../common/utils/pagination.util';
import { PrismaService } from '../prisma/prisma.service';

export type MaintenanceCreateData = {
  propertyId: string;
  tenantId?: string;
  title: string;
  description: string;
  urgency?: MaintenanceUrgency;
  images?: string[];
};

const MAINTENANCE_QUERY_FIELDS: QueryField[] = [
  { filterKey: 'status',     prismaField: 'status',     filterable: true, filterType: 'exact' },
  { filterKey: 'urgency',    prismaField: 'urgency',    filterable: true, filterType: 'exact' },
  { filterKey: 'propertyId', prismaField: 'propertyId', filterable: true, filterType: 'exact' },
  { filterKey: 'createdAt',  prismaField: 'createdAt',  sortable: true },
];

@Injectable()
export class MaintenanceRepository extends BaseRepository<MaintenanceRequest, MaintenanceCreateData> {
  constructor(private readonly prisma: PrismaService) {
    super(
      prisma.maintenanceRequest as unknown as PrismaModelDelegate<MaintenanceRequest>,
      MAINTENANCE_QUERY_FIELDS,
    );
  }

  override async findWithPagination(
    request: ISearchRequest,
    baseWhere: Record<string, unknown> = {},
  ): Promise<PaginatedResult<MaintenanceRequest>> {
    const pageNumber = request.pageNumber ?? 0;
    const pageSize = request.pageSize ?? 20;
    const where = this.buildSearchWhere(request, baseWhere);

    const [data, total] = await Promise.all([
      this.prisma.maintenanceRequest.findMany({
        where,
        skip: pageNumber * pageSize,
        take: pageSize,
        include: { property: { select: { id: true, title: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.maintenanceRequest.count({ where }),
    ]);

    return {
      data: data as unknown as MaintenanceRequest[],
      meta: buildMeta(total, pageNumber, pageSize),
    };
  }

  findManagedPropertyIds(managerId: string): Promise<{ propertyId: string }[]> {
    return this.prisma.mandate.findMany({
      where: { managerId, status: 'ACTIVE', deletedAt: null },
      select: { propertyId: true },
    });
  }
}
