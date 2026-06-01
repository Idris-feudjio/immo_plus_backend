import { Injectable, NotFoundException } from '@nestjs/common';
import { Payment, PaymentStatus } from '@prisma/client';
import type { PaginatedResult } from '../common/interfaces/paginated-result.interface';
import {
  CreatePaymentDto,
  FilterPaymentsDto,
  SendRemindersDto,
  UpdatePaymentDto,
} from './dto/payment.dto';
import type { IPaymentsService } from './interfaces/payments-service.interface';
import { PaymentRepository } from './payment.repository';

@Injectable()
export class PaymentsService implements IPaymentsService {
  constructor(private readonly repository: PaymentRepository) {}

  list(userId: string, role: string, query: FilterPaymentsDto): Promise<PaginatedResult<Payment>> {
    return this.repository.findListPaginated(userId, role, query);
  }

  async create(userId: string, role: string, dto: CreatePaymentDto): Promise<Payment> {
    const contractWithProp = await this.repository.findContractWithProperty(dto.contractId);
    if (!contractWithProp) throw new NotFoundException('Contrat introuvable.');

    const property = (contractWithProp as never as { property: { ownerId: string; managerId: string | null } }).property;

    // Re-use assertAccess pattern via repository
    await this.repository.findPaymentWithPropertyOrThrow(
      // Need a payment id to assert access — for creation, check manually
      '' as never,
      userId,
      role,
    ).catch(() => {
      // On creation we check the property directly
    });

    // Simplified access check for create
    if (role !== 'ADMIN' && property.ownerId !== userId && property.managerId !== userId) {
      throw new NotFoundException('Droits insuffisants.');
    }

    const existing = await this.repository.findByContractAndPeriod(dto.contractId, dto.period);

    return this.repository.createOrUpdate(
      existing?.id ?? null,
      {
        contractId: dto.contractId,
        tenantId: (contractWithProp as never as { tenantId: string }).tenantId,
        propertyId: (contractWithProp as never as { propertyId: string }).propertyId,
        amount: dto.amount,
        period: dto.period,
        dueDate: new Date(dto.dueDate),
        paymentDate: dto.paymentDate ? new Date(dto.paymentDate) : undefined,
        status: dto.status,
        paymentMethod: dto.paymentMethod,
        reference: dto.reference,
      },
      {
        amount: dto.amount,
        status: dto.status,
        paymentDate: dto.paymentDate ? new Date(dto.paymentDate) : undefined,
        paymentMethod: dto.paymentMethod,
        reference: dto.reference,
      },
    );
  }

  async update(id: string, userId: string, role: string, dto: UpdatePaymentDto): Promise<Payment> {
    await this.repository.findPaymentWithPropertyOrThrow(id, userId, role);
    return this.repository.updateWithInclude(id, dto as never);
  }

  async getOverdue(userId: string, role: string): Promise<{ data: Payment[] }> {
    const data = await this.repository.findOverdue(userId, role);
    return { data };
  }

  async sendReminders(
    userId: string,
    role: string,
    dto: SendRemindersDto,
  ): Promise<{ sent: number; channel: string }> {
    const payments = await this.repository.findForReminders(userId, role, dto.paymentIds);
    // TODO: send actual reminders via BullMQ queue
    console.log(`Sending ${dto.channel} reminders for ${payments.length} payments`);
    return { sent: payments.length, channel: dto.channel };
  }

  async getStats(
    userId: string,
    role: string,
    query: { year?: number; month?: number; propertyId?: string },
  ) {
    const { paid, pending, late } = await this.repository.aggregateStats(userId, role, query);

    const totalCollected = paid._sum.amount ?? 0;
    const totalPending = pending._sum.amount ?? 0;
    const totalLate = late._sum.amount ?? 0;
    const totalExpected = totalCollected + totalPending + totalLate;
    const collectionRate = totalExpected > 0 ? (totalCollected / totalExpected) * 100 : 0;

    return {
      totalCollected,
      totalPending,
      totalLate,
      collectionRate: Math.round(collectionRate * 10) / 10,
    };
  }

  async getReceiptUrl(id: string, userId: string, role: string): Promise<{ receiptUrl: string }> {
    await this.repository.findPaymentWithPropertyOrThrow(id, userId, role);
    const payment = await this.repository.findPaymentById(id);
    if (!payment?.receiptUrl) throw new NotFoundException('Quittance non disponible.');
    return { receiptUrl: payment.receiptUrl };
  }
}
