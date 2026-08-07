import { Injectable } from '@nestjs/common';
import { ContractSection, ContractTemplate } from '@prisma/client';
import {
  BaseRepository,
  PrismaModelDelegate,
} from '../common/abstractions/base.repository';
import type { PaginatedResult } from '../common/interfaces/paginated-result.interface';
import type {
  QueryField,
  ISearchRequest,
} from '../common/interfaces/search-request.interface';
import { buildMeta } from '../common/utils/pagination.util';
import { PrismaService } from '../prisma/prisma.service';

export type ContractTemplateCreateData = {
  agencyId: string;
  name: string;
  lockedSections?: ContractSection[];
  clauses?: { create: { text: string; order: number }[] };
};

// agencyId is intentionally NOT filterable here — BaseRepository.buildSearchWhere()
// applies request.filters after baseWhere, so a client-supplied agencyId filter
// would silently override the server-computed agency scoping in search().
const CONTRACT_TEMPLATE_QUERY_FIELDS: QueryField[] = [
  { filterKey: 'name', prismaField: 'name', searchable: true },
  { filterKey: 'createdAt', prismaField: 'createdAt', sortable: true },
];

const CONTRACT_TEMPLATE_INCLUDE = {
  clauses: { orderBy: { order: 'asc' as const } },
};

@Injectable()
export class ContractTemplateRepository extends BaseRepository<
  ContractTemplate,
  ContractTemplateCreateData
> {
  constructor(private readonly prisma: PrismaService) {
    super(
      prisma.contractTemplate as unknown as PrismaModelDelegate<ContractTemplate>,
      CONTRACT_TEMPLATE_QUERY_FIELDS,
    );
  }

  override async create(
    data: ContractTemplateCreateData,
  ): Promise<ContractTemplate> {
    return this.prisma.contractTemplate.create({
      data,
      include: CONTRACT_TEMPLATE_INCLUDE,
    });
  }

  override async findById(id: string): Promise<ContractTemplate | null> {
    return this.prisma.contractTemplate.findUnique({
      where: { id },
      include: CONTRACT_TEMPLATE_INCLUDE,
    });
  }

  override async findWithPagination(
    request: ISearchRequest,
    baseWhere: Record<string, unknown> = {},
  ): Promise<PaginatedResult<ContractTemplate>> {
    const pageNumber = request.pageNumber ?? 0;
    const pageSize = request.pageSize ?? 10;
    const where = this.buildSearchWhere(request, baseWhere);
    const orderBy = this.buildSearchOrderBy(
      request.sortClauses ?? [{ fieldName: 'createdAt', direction: 'DESC' }],
    );

    const [data, total] = await Promise.all([
      this.prisma.contractTemplate.findMany({
        where,
        skip: pageNumber * pageSize,
        take: pageSize,
        orderBy: orderBy.length ? orderBy : { createdAt: 'desc' },
        include: CONTRACT_TEMPLATE_INCLUDE,
      }),
      this.prisma.contractTemplate.count({ where }),
    ]);

    return {
      data: data as unknown as ContractTemplate[],
      meta: buildMeta(total, pageNumber, pageSize),
    };
  }
}
