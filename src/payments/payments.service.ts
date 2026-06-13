import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CommissionCategory, CommissionStatus, Payment, PaymentStatus, Role } from '@prisma/client';
import { StorageService } from '../storage/storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationRepository } from '../notifications/notification.repository';
import { EmailQueueService } from '../notifications/email-queue.service';
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
  constructor(
    private readonly repository: PaymentRepository,
    private readonly storage: StorageService,
    private readonly prisma: PrismaService,
    private readonly notificationRepo: NotificationRepository,
    private readonly emailQueue: EmailQueueService,
  ) {}

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

    const isNew = !existing;

    const payment = await this.repository.createOrUpdate(
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

    // Auto-generate commissions for new paid payments
    if (isNew && dto.status === PaymentStatus.PAID) {
      const propertyId = (contractWithProp as never as { propertyId: string }).propertyId;
      await this.generateCommissions(propertyId, dto.amount, payment.id, (contractWithProp as never as { id: string }).id);
    }

    return payment;
  }

  private async generateCommissions(
    propertyId: string,
    paymentAmount: number,
    _paymentId: string,
    contractId: string,
  ): Promise<void> {
    const mandates = await this.prisma.mandate.findMany({
      where: {
        propertyId,
        status: 'ACTIVE',
        commissionType: { not: null },
        deletedAt: null,
      },
      select: {
        id: true,
        agencyId: true,
        commissionType: true,
        commissionValue: true,
      },
    });

    if (mandates.length === 0) return;

    const property = await this.prisma.property.findUnique({
      where: { id: propertyId },
      select: {
        title: true,
        owner: { select: { id: true, email: true, firstName: true, lastName: true } },
      },
    });

    for (const mandate of mandates) {
      if (!mandate.commissionType || mandate.commissionValue === null) continue;

      let amountHT: number;
      if (mandate.commissionType === 'PERCENTAGE') {
        amountHT = Math.round(paymentAmount * Number(mandate.commissionValue) / 100);
      } else {
        amountHT = Math.round(Number(mandate.commissionValue));
      }

      const tvaAmount = Math.round(amountHT * 19.25 / 100);
      const amountTTC = amountHT + tvaAmount;

      await this.prisma.commission.create({
        data: {
          mandateId: mandate.id,
          contractId,
          agencyId: mandate.agencyId,
          type: CommissionCategory.MANAGEMENT,
          amountHT,
          tvaRate: 19.25,
          tvaAmount,
          amountTTC,
          status: CommissionStatus.PENDING,
        },
      });

      const owner = (property as { owner?: { id: string; email: string; firstName: string; lastName: string } } | null)?.owner;
      if (owner) {
        await this.notificationRepo.create({
          userId: owner.id,
          type: 'commission_generated',
          title: 'Commission générée',
          body: `Une commission de ${amountTTC} FCFA TTC a été générée pour "${property?.title}".`,
        });
        await this.emailQueue.sendEmail({
          to: owner.email,
          subject: 'Nouvelle commission de gestion',
          template: 'commission-generated',
          data: { ownerName: owner.firstName, amount: amountTTC, propertyTitle: property?.title ?? '' },
        });
      }
    }
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
    if (role === Role.TENANT) {
      const payment = await this.repository.findPaymentById(id);
      if (!payment) throw new NotFoundException('Paiement introuvable.');
      const tenant = await this.repository.findTenantByUserId(userId);
      if (!tenant || payment.tenantId !== tenant.id) {
        throw new ForbiddenException('Droits insuffisants.');
      }
      if (payment.status !== PaymentStatus.PAID) throw new ConflictException('PAYMENT_NOT_PAID');
      if (!payment.receiptUrl) throw new NotFoundException('Quittance non disponible.');
      const key = this.storage.keyFromUrl(payment.receiptUrl);
      return { receiptUrl: await this.storage.getSignedUrl(key, 3600) };
    }

    await this.repository.findPaymentWithPropertyOrThrow(id, userId, role);
    const payment = await this.repository.findPaymentById(id);
    if (!payment) throw new NotFoundException('Paiement introuvable.');
    if (payment.status !== PaymentStatus.PAID) throw new ConflictException('PAYMENT_NOT_PAID');
    if (!payment.receiptUrl) throw new NotFoundException('Quittance non disponible.');
    const key = this.storage.keyFromUrl(payment.receiptUrl);
    return { receiptUrl: await this.storage.getSignedUrl(key, 3600) };
  }
}
