import { Injectable, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  Contract,
  ContractStatus,
  PaymentStatus,
  Property,
  PropertyStatus,
  Role,
  Tenant,
  Prisma,
} from '@prisma/client';
import {
  BaseRepository,
  PrismaModelDelegate,
} from '../common/abstractions/base.repository';
import type { PaginatedResult } from '../common/interfaces/paginated-result.interface';
import type { QueryField, SearchRequest } from '../common/interfaces/search-request.interface';
import { buildMeta } from '../common/utils/pagination.util';
import { PrismaService } from '../prisma/prisma.service';
import { FilterContractsDto } from './dto/contract.dto';

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

  /** Paginated list with role-based scoping. */
  async findListPaginated(
    userId: string,
    role: string,
    query: FilterContractsDto,
  ): Promise<PaginatedResult<Contract>> {
    const { page = 1, limit = 20 } = query;
    const baseWhere = await this.buildRoleWhere(userId, role);
    if (query.status) baseWhere.status = query.status;
    if (query.propertyId) baseWhere.propertyId = query.propertyId;
    if (query.tenantId) baseWhere.tenantId = query.tenantId;

    const [data, total] = await Promise.all([
      this.prisma.contract.findMany({
        where: baseWhere,
        skip: (page - 1) * limit,
        take: limit,
        include: CONTRACT_LIST_INCLUDE,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.contract.count({ where: baseWhere }),
    ]);

    return { data: data as Contract[], meta: buildMeta(total, page - 1, limit) };
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

  /** Verify access and return the contract, throws if no access. */
  async assertAccess(contract: Contract, userId: string, role: string): Promise<void> {
    if (role === Role.ADMIN) return;
    if (role === Role.TENANT) {
      const tenant = await this.findTenantByUserId(userId);
      if (!tenant || tenant.id !== (contract as never as { tenantId: string }).tenantId) {
        throw new ForbiddenException({ error: 'INSUFFICIENT_PERMISSIONS', message: 'Droits insuffisants.' });
      }
      return;
    }
    const property = await this.findPropertyById((contract as never as { propertyId: string }).propertyId);
    if (!property || (property.ownerId !== userId && property.managerId !== userId)) {
      throw new ForbiddenException({ error: 'INSUFFICIENT_PERMISSIONS', message: 'Droits insuffisants.' });
    }
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private async buildRoleWhere(
    userId: string,
    role: string,
  ): Promise<Record<string, unknown>> {
    const where: Record<string, unknown> = {};
    if (role === Role.TENANT) {
      const tenant = await this.findTenantByUserId(userId);
      if (tenant) where.tenantId = tenant.id;
      else where.id = 'never';
    } else if (role !== Role.ADMIN) {
      where.property = { ownerId: userId };
    }
    return where;
  }
}
