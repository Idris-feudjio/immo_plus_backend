import { Injectable } from '@nestjs/common';
import { Agency, AgencyStatus } from '@prisma/client';
import { BaseRepository, PrismaModelDelegate } from '../common/abstractions/base.repository';
import type { PaginatedResult } from '../common/interfaces/paginated-result.interface';
import type { QueryField, ISearchRequest } from '../common/interfaces/search-request.interface';
import { buildMeta } from '../common/utils/pagination.util';
import { PrismaService } from '../prisma/prisma.service';

export type AgencyCreateData = {
  name: string;
  email: string;
  phone: string;
  address?: string | null;
  rccm?: string | null;
  status?: AgencyStatus;
};

const AGENCY_QUERY_FIELDS: QueryField[] = [
  { filterKey: 'status',    prismaField: 'status',    filterable: true, filterType: 'exact' },
  { filterKey: 'name',      prismaField: 'name',      searchable: true },
  { filterKey: 'createdAt', prismaField: 'createdAt', sortable: true },
];

@Injectable()
export class AgencyRepository extends BaseRepository<Agency, AgencyCreateData> {
  constructor(private readonly prisma: PrismaService) {
    super(prisma.agency as unknown as PrismaModelDelegate<Agency>, AGENCY_QUERY_FIELDS);
  }

  override async findWithPagination(
    request: ISearchRequest,
    baseWhere: Record<string, unknown> = {},
  ): Promise<PaginatedResult<Agency>> {
    const pageNumber = request.pageNumber ?? 0;
    const pageSize = request.pageSize ?? 10;
    const where = this.buildSearchWhere(request, baseWhere);
    const orderBy = this.buildSearchOrderBy(
      request.sortClauses ?? [{ fieldName: 'createdAt', direction: 'DESC' }],
    );

    const [data, total] = await Promise.all([
      this.prisma.agency.findMany({
        where,
        skip: pageNumber * pageSize,
        take: pageSize,
        orderBy: orderBy.length ? orderBy : { createdAt: 'desc' },
        include: { _count: { select: { members: true } } },
      }),
      this.prisma.agency.count({ where }),
    ]);

    return { data: data as unknown as Agency[], meta: buildMeta(total, pageNumber, pageSize) };
  }
}
