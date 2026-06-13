import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Application, ApplicationStatus, ContractStatus, Property, Tenant } from '@prisma/client';
import {
  BaseRepository,
  PrismaModelDelegate,
} from '../common/abstractions/base.repository';
import type { PaginatedResult } from '../common/interfaces/paginated-result.interface';
import type { QueryField, SearchRequest } from '../common/interfaces/search-request.interface';
import { buildMeta } from '../common/utils/pagination.util';
import { PrismaService } from '../prisma/prisma.service';
import { CreateApplicationDto, CreateTenantDto } from './dto/tenant.dto';

export type TenantCreateData = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  nationalIdNumber: string;
  occupation: string;
  income: number;
  ownerId: string;
  userId?: string;
};

const TENANT_QUERY_FIELDS: QueryField[] = [
  { filterKey: 'lastName',  prismaField: 'lastName',  searchable: true },
  { filterKey: 'email',     prismaField: 'email',     searchable: true },
  { filterKey: 'ownerId',   prismaField: 'ownerId',   filterable: true, filterType: 'exact' },
  { filterKey: 'createdAt', prismaField: 'createdAt', sortable: true },
];

@Injectable()
export class TenantRepository extends BaseRepository<Tenant, TenantCreateData> {
  constructor(private readonly prisma: PrismaService) {
    super(
      prisma.tenant as unknown as PrismaModelDelegate<Tenant>,
      TENANT_QUERY_FIELDS,
    );
  }

  /** Paginated tenants with active contract info. */
  async findListPaginated(
    ownerId: string,
    role: string,
    query: { search?: string; page?: number; limit?: number },
  ): Promise<PaginatedResult<Tenant>> {
    const { page = 1, limit = 20, search } = query;
    const baseWhere = role !== 'ADMIN' ? { ownerId } : {};

    const request: SearchRequest = {
      searchKey: search,
      pageNumber: page - 1,
      pageSize: limit,
      sortClauses: [{ fieldName: 'createdAt', direction: 'DESC' }],
    };

    const where = this.buildSearchWhere(request, baseWhere);
    const [data, total] = await Promise.all([
      this.prisma.tenant.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        include: {
          contracts: {
            where: { status: ContractStatus.ACTIVE },
            take: 1,
            include: { property: { select: { title: true } } },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.tenant.count({ where }),
    ]);

    return { data: data as Tenant[], meta: buildMeta(total, page - 1, limit) };
  }

  findByIdWithRelations(id: string): Promise<Tenant | null> {
    return this.prisma.tenant.findUnique({
      where: { id },
      include: {
        contracts: {
          include: { property: { select: { id: true, title: true, slug: true } } },
          orderBy: { createdAt: 'desc' },
        },
        payments: { orderBy: { dueDate: 'desc' }, take: 20 },
      },
    }) as Promise<Tenant | null>;
  }

  findByUserId(userId: string) {
    return this.prisma.tenant.findFirst({ where: { userId } });
  }

  findPaymentsForTenant(tenantId: string) {
    return this.prisma.payment.findMany({
      where: {
        tenantId,
        contract: { status: ContractStatus.ACTIVE },
      },
      select: {
        id: true,
        status: true,
        amount: true,
        dueDate: true,
        period: true,
        receiptUrl: true,
        paymentDate: true,
        paymentMethod: true,
        property: { select: { id: true, title: true } },
      },
      orderBy: { dueDate: 'desc' },
    });
  }

  findUserByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  findPropertyBySlug(slug: string): Promise<Property | null> {
    return this.prisma.property.findFirst({ where: { slug, deletedAt: null } });
  }

  createApplication(data: {
    propertyId: string;
    tenantId?: string;
    message?: string;
    income?: number;
    occupation?: string;
  }): Promise<Application> {
    return this.prisma.application.create({ data });
  }

  findApplications(propertyId: string): Promise<Application[]> {
    return this.prisma.application.findMany({
      where: { propertyId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findApplicationByIdOrThrow(applicationId: string, propertyId: string): Promise<Application> {
    const app = await this.prisma.application.findFirst({ where: { id: applicationId, propertyId } });
    if (!app) throw new NotFoundException('Candidature introuvable.');
    return app;
  }

  updateApplicationStatus(applicationId: string, status: ApplicationStatus): Promise<Application> {
    return this.prisma.application.update({
      where: { id: applicationId },
      data: { status },
    });
  }

  async createNotification(data: {
    userId: string;
    type: string;
    title: string;
    body: string;
    link?: string;
  }): Promise<void> {
    await this.prisma.notification.create({ data });
  }
}
