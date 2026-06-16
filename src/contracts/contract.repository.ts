import { Injectable } from '@nestjs/common';
import {
  Contract,
  ContractStatus,
  Property,
  Tenant,
  Prisma,
} from '@prisma/client';
import {
  BaseRepository,
  PrismaModelDelegate,
} from '../common/abstractions/base.repository';
import type { PaginatedResult } from '../common/interfaces/paginated-result.interface';
import type { QueryField, ISearchRequest } from '../common/interfaces/search-request.interface';
import { buildMeta } from '../common/utils/pagination.util';
import { PrismaService } from '../prisma/prisma.service';

export type ContractCreateData = {
  propertyId: string;
  tenantId: string;
  startDate: Date;
  endDate: Date;
  rent: number;
  fees: number;
  deposit: number;
  status?: ContractStatus;
  parentContractId?: string;
};

const CONTRACT_QUERY_FIELDS: QueryField[] = [
  { filterKey: 'status',     prismaField: 'status',     filterable: true, filterType: 'exact' },
  { filterKey: 'propertyId', prismaField: 'propertyId', filterable: true, filterType: 'exact' },
  { filterKey: 'tenantId',   prismaField: 'tenantId',   filterable: true, filterType: 'exact' },
  { filterKey: 'createdAt',  prismaField: 'createdAt',  sortable: true },
];

const CONTRACT_LIST_INCLUDE = {
  property: { select: { id: true, title: true, images: { where: { isCover: true as const }, take: 1 } } },
  tenant: { select: { id: true, lastName: true, firstName: true, email: true } },
} as const;

@Injectable()
export class ContractRepository extends BaseRepository<Contract, ContractCreateData> {
  constructor(private readonly prisma: PrismaService) {
    super(
      prisma.contract as unknown as PrismaModelDelegate<Contract>,
      CONTRACT_QUERY_FIELDS,
    );
  }

  override async findWithPagination(
    request: ISearchRequest,
    baseWhere: Record<string, unknown> = {},
  ): Promise<PaginatedResult<Contract>> {
    const pageNumber = request.pageNumber ?? 0;
    const pageSize = request.pageSize ?? 20;
    const where = this.buildSearchWhere(request, baseWhere);
    const orderBy = this.buildSearchOrderBy(
      request.sortClauses ?? [{ fieldName: 'createdAt', direction: 'DESC' }],
    );

    const [data, total] = await Promise.all([
      this.prisma.contract.findMany({
        where,
        skip: pageNumber * pageSize,
        take: pageSize,
        include: CONTRACT_LIST_INCLUDE,
        orderBy: orderBy.length ? orderBy : { createdAt: 'desc' },
      }),
      this.prisma.contract.count({ where }),
    ]);

    return { data: data as unknown as Contract[], meta: buildMeta(total, pageNumber, pageSize) };
  }

  findByIdWithDetails(id: string): Promise<Contract | null> {
    return this.prisma.contract.findUnique({
      where: { id },
      include: {
        property: { include: { images: { where: { isCover: true }, take: 1 } } },
        tenant: true,
        clauses: { orderBy: { order: 'asc' } },
        payments: { orderBy: { dueDate: 'asc' } },
      },
    }) as Promise<Contract | null>;
  }

  findPropertyForContract(propertyId: string): Promise<Property | null> {
    return this.prisma.property.findFirst({ where: { id: propertyId, deletedAt: null } });
  }

  findActiveContractForProperty(propertyId: string): Promise<Contract | null> {
    return this.prisma.contract.findFirst({
      where: { propertyId, status: ContractStatus.ACTIVE },
    });
  }

  findTenantByUserId(userId: string): Promise<Tenant | null> {
    return this.prisma.tenant.findFirst({ where: { userId } });
  }

  findPropertyById(propertyId: string): Promise<Property | null> {
    return this.prisma.property.findUnique({ where: { id: propertyId } });
  }

  findByIdForPdf(id: string) {
    return this.prisma.contract.findUnique({
      where: { id },
      select: {
        id: true,
        rent: true,
        fees: true,
        deposit: true,
        startDate: true,
        endDate: true,
        pdfUrl: true,
        property: {
          select: {
            title: true,
            address: true,
            city: true,
            owner: { select: { firstName: true, lastName: true } },
          },
        },
        tenant: { select: { firstName: true, lastName: true, nationalIdNumber: true } },
        clauses: { select: { text: true }, orderBy: { order: 'asc' } },
      },
    });
  }

  updatePdfUrl(id: string, pdfUrl: string): Promise<Contract> {
    return this.prisma.contract.update({ where: { id }, data: { pdfUrl } });
  }

}
