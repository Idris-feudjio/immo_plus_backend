import { Injectable, NotFoundException } from '@nestjs/common';
import { Application, ApplicationStatus, ContractStatus, Property, Tenant } from '@prisma/client';
import {
  BaseRepository,
  PrismaModelDelegate,
} from '../common/abstractions/base.repository';
import type { PaginatedResult } from '../common/interfaces/paginated-result.interface';
import type { QueryField, ISearchRequest } from '../common/interfaces/search-request.interface';
import { buildMeta } from '../common/utils/pagination.util';
import { PrismaService } from '../prisma/prisma.service';

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

  /** Paginated tenants with their active contract — role-based scope is passed as baseWhere by the service. */
  override async findWithPagination(
    request: ISearchRequest,
    baseWhere: Record<string, unknown> = {},
  ): Promise<PaginatedResult<Tenant>> {
    const pageNumber = request.pageNumber ?? 0;
    const pageSize = request.pageSize ?? 20;
    const where = this.buildSearchWhere(request, baseWhere);
    const orderBy = this.buildSearchOrderBy(
      request.sortClauses ?? [{ fieldName: 'createdAt', direction: 'DESC' }],
    );

    const [data, total] = await Promise.all([
      this.prisma.tenant.findMany({
        where,
        skip: pageNumber * pageSize,
        take: pageSize,
        include: {
          contracts: {
            where: { status: ContractStatus.ACTIVE },
            take: 1,
            include: { property: { select: { title: true } } },
          },
        },
        orderBy: orderBy.length ? orderBy : { createdAt: 'desc' },
      }),
      this.prisma.tenant.count({ where }),
    ]);

    return { data: data as unknown as Tenant[], meta: buildMeta(total, pageNumber, pageSize) };
  }

  /** Full detail view with contract history and recent payments. */
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
    firstName: string;
    lastName: string;
    email: string;
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
