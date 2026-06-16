import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CommissionCategory, CommissionStatus, Payment, PaymentStatus, Role } from '@prisma/client';
import { BaseService } from '../common/abstractions/base.service';
import { StorageService } from '../storage/storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationRepository } from '../notifications/notification.repository';
import { EmailQueueService } from '../notifications/email-queue.service';
import type { PaginatedResult } from '../common/interfaces/paginated-result.interface';
import {
  CreatePaymentDto,
  SendRemindersDto,
  UpdatePaymentDto,
} from './dto/payment.dto';
import type { ISearchRequest } from '../common/interfaces/search-request.interface';
import { PaymentCreateData, PaymentRepository } from './payment.repository';

@Injectable()
export class PaymentsService extends BaseService<Payment, PaymentCreateData> {
  constructor(
    protected override readonly repository: PaymentRepository,
    private readonly storage: StorageService,
    private readonly prisma: PrismaService,
    private readonly notificationRepo: NotificationRepository,
    private readonly emailQueue: EmailQueueService,
  ) {
    super(repository);
  }

  async search(userId: string, role: string, query: ISearchRequest): Promise<PaginatedResult<Payment>> {
    const baseWhere = await this.buildBaseWhere(userId, role);
    return this.findWithPagination(query, baseWhere);
  }

  async createPayment(userId: string, role: string, dto: CreatePaymentDto): Promise<Payment> {
    const contractWithProp = await this.repository.findContractWithProperty(dto.contractId);
    if (!contractWithProp) throw new NotFoundException('Contrat introuvable.');

    const property = (contractWithProp as never as { property: { ownerId: string; managerId: string | null } }).property;

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

  async updatePayment(id: string, userId: string, role: string, dto: UpdatePaymentDto): Promise<Payment> {
    const payment = await this.repository.findPaymentWithProperty(id);
    if (!payment) throw new NotFoundException('Paiement introuvable.');
    if (role !== Role.ADMIN) {
      const prop = (payment as never as { property: { ownerId: string; managerId: string | null } }).property;
      if (prop.ownerId !== userId && prop.managerId !== userId) {
        throw new ForbiddenException({ error: 'INSUFFICIENT_PERMISSIONS', message: 'Droits insuffisants.' });
      }
    }
    return this.repository.updateWithInclude(id, dto as never);
  }

  async getOverdue(userId: string, role: string): Promise<{ data: Payment[] }> {
    const baseWhere = await this.buildBaseWhere(userId, role);
    const data = await this.repository.findOverdue(baseWhere);
    return { data };
  }

  async sendReminders(
    userId: string,
    role: string,
    dto: SendRemindersDto,
  ): Promise<{ sent: number; channel: string }> {
    const baseWhere = await this.buildBaseWhere(userId, role);
    const payments = await this.repository.findForReminders(baseWhere, dto.paymentIds);
    // TODO: send actual reminders via BullMQ queue
    console.log(`Sending ${dto.channel} reminders for ${payments.length} payments`);
    return { sent: payments.length, channel: dto.channel };
  }

  async getStats(
    userId: string,
    role: string,
    query: { year?: number; month?: number; propertyId?: string },
  ) {
    const baseWhere = await this.buildBaseWhere(userId, role);
    const { paid, pending, late } = await this.repository.aggregateStats(baseWhere, query);

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

    const payment = await this.repository.findPaymentWithProperty(id);
    if (!payment) throw new NotFoundException('Paiement introuvable.');
    if (role !== Role.ADMIN) {
      const prop = (payment as never as { property: { ownerId: string; managerId: string | null } }).property;
      if (prop.ownerId !== userId && prop.managerId !== userId) {
        throw new ForbiddenException('Droits insuffisants.');
      }
    }
    const p = await this.repository.findPaymentById(id);
    if (!p) throw new NotFoundException('Paiement introuvable.');
    if (p.status !== PaymentStatus.PAID) throw new ConflictException('PAYMENT_NOT_PAID');
    if (!p.receiptUrl) throw new NotFoundException('Quittance non disponible.');
    const key = this.storage.keyFromUrl(p.receiptUrl);
    return { receiptUrl: await this.storage.getSignedUrl(key, 3600) };
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private async buildBaseWhere(userId: string, role: string): Promise<Record<string, unknown>> {
    const where: Record<string, unknown> = {};
    if (role === Role.TENANT) {
      const tenant = await this.repository.findTenantByUserId(userId);
      where.tenantId = tenant ? tenant.id : 'never';
    } else if (role !== Role.ADMIN) {
      where.property = { ownerId: userId };
    }
    return where;
  }
}
