import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  Payment,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  Role,
} from '@prisma/client';
import {
  BaseRepository,
  PrismaModelDelegate,
} from '../common/abstractions/base.repository';
import type { PaginatedResult } from '../common/interfaces/paginated-result.interface';
import type { QueryField, SearchRequest } from '../common/interfaces/search-request.interface';
import { buildMeta } from '../common/utils/pagination.util';
import { PrismaService } from '../prisma/prisma.service';
import { FilterPaymentsDto, SendRemindersDto } from './dto/payment.dto';

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
  { filterKey: 'dueDate',    prismaField: 'dueDate',    sortable: true },
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

  /** Paginated list with role-based scoping. */
  async findListPaginated(
    userId: string,
    role: string,
    query: FilterPaymentsDto,
  ): Promise<PaginatedResult<Payment>> {
    const { page = 1, limit = 20 } = query;
    const where = await this.buildOwnerWhere(userId, role, query);

    const orderBy: Prisma.PaymentOrderByWithRelationInput =
      query.sort === 'dueDate' ? { dueDate: 'asc' } : { dueDate: 'desc' };

    const [data, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        include: PAYMENT_INCLUDE,
        orderBy,
      }),
      this.prisma.payment.count({ where }),
    ]);

    return { data: data as Payment[], meta: buildMeta(total, page - 1, limit) };
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

  async findPaymentWithPropertyOrThrow(id: string, userId: string, role: string): Promise<Payment> {
    const payment = await this.prisma.payment.findUnique({
      where: { id },
      include: PAYMENT_INCLUDE,
    });
    if (!payment) throw new NotFoundException('Paiement introuvable.');

    if (role !== Role.ADMIN) {
      const prop = (payment as never as { property: { ownerId: string; managerId: string | null } }).property;
      if (prop.ownerId !== userId && prop.managerId !== userId) {
        throw new ForbiddenException({ error: 'INSUFFICIENT_PERMISSIONS', message: 'Droits insuffisants.' });
      }
    }
    return payment;
  }

  async findOverdue(userId: string, role: string): Promise<Payment[]> {
    const where = await this.buildOwnerWhere(userId, role, {});
    (where as Record<string, unknown>).status = PaymentStatus.PENDING;
    (where as Record<string, unknown>).dueDate = { lt: new Date() };

    return this.prisma.payment.findMany({
      where,
      include: PAYMENT_INCLUDE,
      orderBy: { dueDate: 'asc' },
    }) as unknown as Payment[];
  }

  async findForReminders(userId: string, role: string, paymentIds: string[]): Promise<Payment[]> {
    const where = await this.buildOwnerWhere(userId, role, {});
    (where as Record<string, unknown>).id = { in: paymentIds };
    (where as Record<string, unknown>).status = { in: [PaymentStatus.PENDING, PaymentStatus.LATE] };

    return this.prisma.payment.findMany({ where });
  }

  async aggregateStats(
    userId: string,
    role: string,
    query: { year?: number; month?: number; propertyId?: string },
  ) {
    const where = await this.buildOwnerWhere(userId, role, {});
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

  // ── Private helpers ──────────────────────────────────────────────────────

  async buildOwnerWhere(
    userId: string,
    role: string,
    filters: Partial<FilterPaymentsDto>,
  ): Promise<Record<string, unknown>> {
    const where: Record<string, unknown> = {};

    if (role === Role.TENANT) {
      const tenant = await this.prisma.tenant.findFirst({ where: { userId } });
      where.tenantId = tenant ? tenant.id : 'never';
    } else if (role !== Role.ADMIN) {
      where.property = { ownerId: userId };
    }

    if (filters.contractId) where.contractId = filters.contractId;
    if (filters.tenantId) where.tenantId = filters.tenantId;
    if (filters.propertyId) where.propertyId = filters.propertyId;
    if (filters.status) where.status = filters.status;
    if (filters.period) where.period = filters.period;
    if (filters.startDate || filters.endDate) {
      where.dueDate = {
        gte: filters.startDate ? new Date(filters.startDate) : undefined,
        lte: filters.endDate ? new Date(filters.endDate) : undefined,
      };
    }

    return where;
  }
}
