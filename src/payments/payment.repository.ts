import { Injectable } from '@nestjs/common';
import {
  Payment,
  PaymentMethod,
  PaymentStatus,
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

export type PaymentCreateData = {
  contractId: string;
  tenantId: string;
  propertyId: string;
  amount: number;
  period: string;
  dueDate: Date;
  paymentDate?: Date;
  status: PaymentStatus;
  paymentMethod?: PaymentMethod;
  reference?: string;
};

const PAYMENT_QUERY_FIELDS: QueryField[] = [
  { filterKey: 'status',     prismaField: 'status',     filterable: true, filterType: 'exact' },
  { filterKey: 'period',     prismaField: 'period',     filterable: true, filterType: 'exact' },
  { filterKey: 'contractId', prismaField: 'contractId', filterable: true, filterType: 'exact' },
  { filterKey: 'tenantId',   prismaField: 'tenantId',   filterable: true, filterType: 'exact' },
  { filterKey: 'propertyId', prismaField: 'propertyId', filterable: true, filterType: 'exact' },
  { filterKey: 'dueDate',    prismaField: 'dueDate',    sortable: true, filterable: true, filterType: 'date-range' },
];

const PAYMENT_INCLUDE = {
  property: { select: { id: true, title: true, ownerId: true, managerId: true } },
  tenant: { select: { id: true, lastName: true, firstName: true } },
} as const;

@Injectable()
export class PaymentRepository extends BaseRepository<Payment, PaymentCreateData> {
  constructor(private readonly prisma: PrismaService) {
    super(
      prisma.payment as unknown as PrismaModelDelegate<Payment>,
      PAYMENT_QUERY_FIELDS,
    );
  }

  override async findWithPagination(
    request: ISearchRequest,
    baseWhere: Record<string, unknown> = {},
  ): Promise<PaginatedResult<Payment>> {
    const pageNumber = request.pageNumber ?? 0;
    const pageSize = request.pageSize ?? 20;
    const where = this.buildSearchWhere(request, baseWhere);
    const orderBy = this.buildSearchOrderBy(
      request.sortClauses ?? [{ fieldName: 'dueDate', direction: 'DESC' }],
    );

    const [data, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        skip: pageNumber * pageSize,
        take: pageSize,
        include: PAYMENT_INCLUDE,
        orderBy: orderBy.length ? orderBy : { dueDate: 'desc' },
      }),
      this.prisma.payment.count({ where }),
    ]);

    return { data: data as unknown as Payment[], meta: buildMeta(total, pageNumber, pageSize) };
  }

  findByContractAndPeriod(contractId: string, period: string): Promise<Payment | null> {
    return this.prisma.payment.findFirst({ where: { contractId, period } });
  }

  async createOrUpdate(
    existingId: string | null,
    createData: PaymentCreateData,
    updateData: Partial<PaymentCreateData>,
  ): Promise<Payment> {
    if (existingId) {
      return this.prisma.payment.update({
        where: { id: existingId },
        data: updateData,
        include: PAYMENT_INCLUDE,
      }) as unknown as Promise<Payment>;
    }
    return this.prisma.payment.create({
      data: createData,
      include: PAYMENT_INCLUDE,
    }) as unknown as Promise<Payment>;
  }

  updateWithInclude(id: string, data: Partial<PaymentCreateData>): Promise<Payment> {
    return this.prisma.payment.update({
      where: { id },
      data,
      include: PAYMENT_INCLUDE,
    }) as unknown as Promise<Payment>;
  }

  findPaymentWithProperty(id: string): Promise<Payment | null> {
    return this.prisma.payment.findUnique({
      where: { id },
      include: PAYMENT_INCLUDE,
    }) as unknown as Promise<Payment | null>;
  }

  async findOverdue(baseWhere: Record<string, unknown>): Promise<Payment[]> {
    const where = {
      ...baseWhere,
      status: PaymentStatus.PENDING,
      dueDate: { lt: new Date() },
    };
    return this.prisma.payment.findMany({
      where,
      include: PAYMENT_INCLUDE,
      orderBy: { dueDate: 'asc' },
    }) as unknown as Payment[];
  }

  async findForReminders(baseWhere: Record<string, unknown>, paymentIds: string[]): Promise<Payment[]> {
    const where = {
      ...baseWhere,
      id: { in: paymentIds },
      status: { in: [PaymentStatus.PENDING, PaymentStatus.LATE] },
    };
    return this.prisma.payment.findMany({ where });
  }

  async aggregateStats(
    baseWhere: Record<string, unknown>,
    query: { year?: number; month?: number; propertyId?: string },
  ) {
    const where = { ...baseWhere };
    if (query.propertyId) (where as Record<string, unknown>).propertyId = query.propertyId;
    if (query.year) {
      const start = new Date(query.year, (query.month ?? 1) - 1, 1);
      const end = query.month ? new Date(query.year, query.month, 0) : new Date(query.year, 11, 31);
      (where as Record<string, unknown>).dueDate = { gte: start, lte: end };
    }

    const [paid, pending, late] = await Promise.all([
      this.prisma.payment.aggregate({ where: { ...where, status: PaymentStatus.PAID }, _sum: { amount: true }, _count: true }),
      this.prisma.payment.aggregate({ where: { ...where, status: PaymentStatus.PENDING }, _sum: { amount: true }, _count: true }),
      this.prisma.payment.aggregate({ where: { ...where, status: PaymentStatus.LATE }, _sum: { amount: true }, _count: true }),
    ]);
    return { paid, pending, late };
  }

  findContractWithProperty(contractId: string) {
    return this.prisma.contract.findUnique({
      where: { id: contractId },
      include: { property: true },
    });
  }

  findPaymentById(id: string): Promise<Payment | null> {
    return this.prisma.payment.findUnique({ where: { id } });
  }

  findTenantByUserId(userId: string) {
    return this.prisma.tenant.findFirst({ where: { userId } });
  }
}
