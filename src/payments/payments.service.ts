import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreatePaymentDto,
  FilterPaymentsDto,
  SendRemindersDto,
  UpdatePaymentDto,
} from './dto/payment.dto';
import { buildPaginationMeta } from '../common/dto/pagination.dto';
import { PaymentStatus, Role } from '@prisma/client';
import { differenceInDays, format } from 'date-fns';

const PAYMENT_INCLUDE = {
  property: { select: { id: true, title: true } },
  tenant: { select: { id: true, lastName: true, firstName: true } },
};

@Injectable()
export class PaymentsService {
  constructor(private prisma: PrismaService) {}

  async list(userId: string, role: string, query: FilterPaymentsDto) {
    const { page = 1, limit = 20, sort, ...filters } = query;
    const skip = (page - 1) * limit;
    const where: any = await this.buildOwnerWhere(userId, role, filters);

    let orderBy: any = { dueDate: 'desc' };
    if (sort === 'dueDate') orderBy = { dueDate: 'asc' };

    const [data, total] = await Promise.all([
      this.prisma.payment.findMany({ where, skip, take: limit, include: PAYMENT_INCLUDE, orderBy }),
      this.prisma.payment.count({ where }),
    ]);

    return { data, meta: buildPaginationMeta(total, page, limit) };
  }

  async create(userId: string, role: string, dto: CreatePaymentDto) {
    const contract = await this.prisma.contract.findUnique({ where: { id: dto.contractId } });
    if (!contract) throw new NotFoundException('Contrat introuvable.');

    const property = await this.prisma.property.findUnique({ where: { id: contract.propertyId } });
    if (!property) throw new NotFoundException('Bien introuvable.');

    if (role !== Role.admin && property.ownerId !== userId && property.managerId !== userId) {
      throw new ForbiddenException({ error: 'INSUFFICIENT_PERMISSIONS', message: 'Droits insuffisants.' });
    }

    const existing = await this.prisma.payment.findFirst({
      where: { contractId: dto.contractId, period: dto.period },
    });

    if (existing) {
      return this.prisma.payment.update({
        where: { id: existing.id },
        data: {
          amount: dto.amount,
          status: dto.status,
          paymentDate: dto.paymentDate ? new Date(dto.paymentDate) : undefined,
          paymentMethod: dto.paymentMethod,
          reference: dto.reference,
        },
        include: PAYMENT_INCLUDE,
      });
    }

    return this.prisma.payment.create({
      data: {
        contractId: dto.contractId,
        tenantId: contract.tenantId,
        propertyId: contract.propertyId,
        amount: dto.amount,
        period: dto.period,
        dueDate: new Date(dto.dueDate),
        paymentDate: dto.paymentDate ? new Date(dto.paymentDate) : undefined,
        status: dto.status,
        paymentMethod: dto.paymentMethod,
        reference: dto.reference,
      },
      include: PAYMENT_INCLUDE,
    });
  }

  async update(id: string, userId: string, role: string, dto: UpdatePaymentDto) {
    await this.assertAccess(id, userId, role);
    return this.prisma.payment.update({ where: { id }, data: dto, include: PAYMENT_INCLUDE });
  }

  async getOverdue(userId: string, role: string) {
    const where: any = await this.buildOwnerWhere(userId, role, {
      status: PaymentStatus.Pending,
    });
    where.dueDate = { lt: new Date() };
    where.status = { in: [PaymentStatus.Pending, PaymentStatus.Late] };

    const payments = await this.prisma.payment.findMany({
      where,
      include: PAYMENT_INCLUDE,
      orderBy: { dueDate: 'asc' },
    });

    const data = payments.map((p) => ({
      ...p,
      daysLate: differenceInDays(new Date(), new Date(p.dueDate)),
    }));

    return {
      totalAmount: data.reduce((sum, p) => sum + p.amount, 0),
      count: data.length,
      data,
    };
  }

  async sendReminders(userId: string, role: string, dto: SendRemindersDto) {
    const payments = await this.prisma.payment.findMany({
      where: { id: { in: dto.paymentIds } },
      include: { tenant: true },
    });

    // TODO: integrate with email/SMS service
    console.log(`Sending ${dto.channel} reminders for ${payments.length} payments`);

    return { sent: payments.length, channel: dto.channel };
  }

  async getStats(userId: string, role: string, query: { year?: number; month?: number; propertyId?: string }) {
    const where: any = await this.buildOwnerWhere(userId, role, {});

    if (query.propertyId) where.propertyId = query.propertyId;
    if (query.year) {
      const start = new Date(query.year, (query.month ?? 1) - 1, 1);
      const end = query.month
        ? new Date(query.year, query.month, 0)
        : new Date(query.year, 11, 31);
      where.dueDate = { gte: start, lte: end };
    }

    const [paid, pending, late] = await Promise.all([
      this.prisma.payment.aggregate({ where: { ...where, status: PaymentStatus.Paid }, _sum: { amount: true }, _count: true }),
      this.prisma.payment.aggregate({ where: { ...where, status: PaymentStatus.Pending }, _sum: { amount: true }, _count: true }),
      this.prisma.payment.aggregate({ where: { ...where, status: PaymentStatus.Late }, _sum: { amount: true }, _count: true }),
    ]);

    const totalCollected = paid._sum.amount ?? 0;
    const totalExpected = totalCollected + (pending._sum.amount ?? 0) + (late._sum.amount ?? 0);
    const collectionRate = totalExpected > 0 ? (totalCollected / totalExpected) * 100 : 0;

    return {
      totalCollected,
      totalPending: pending._sum.amount ?? 0,
      totalLate: late._sum.amount ?? 0,
      collectionRate: Math.round(collectionRate * 10) / 10,
    };
  }

  async getReceiptUrl(id: string, userId: string, role: string) {
    await this.assertAccess(id, userId, role);
    const payment = await this.prisma.payment.findUnique({ where: { id } });
    if (!payment?.receiptUrl) throw new NotFoundException('Quittance non disponible.');
    return { receiptUrl: payment.receiptUrl };
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private async buildOwnerWhere(userId: string, role: string, filters: Partial<FilterPaymentsDto>) {
    const where: any = {};

    if (role === Role.tenant) {
      const tenant = await this.prisma.tenant.findFirst({ where: { userId } });
      if (tenant) where.tenantId = tenant.id;
      else where.id = 'never';
    } else if (role !== Role.admin) {
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

  private async assertAccess(id: string, userId: string, role: string) {
    const payment = await this.prisma.payment.findUnique({ where: { id }, include: { property: true } });
    if (!payment) throw new NotFoundException('Paiement introuvable.');
    if (role === Role.admin) return payment;
    if (payment.property.ownerId !== userId && payment.property.managerId !== userId) {
      throw new ForbiddenException({ error: 'INSUFFICIENT_PERMISSIONS', message: 'Droits insuffisants.' });
    }
    return payment;
  }
}
