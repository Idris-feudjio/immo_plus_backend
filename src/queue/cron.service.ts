import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { addDays, endOfDay, startOfDay } from 'date-fns';
import { ContractStatus, MandateStatus, PaymentStatus, PropertyStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmailQueueService } from '../notifications/email-queue.service';

@Injectable()
export class CronService {
  private readonly logger = new Logger(CronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailQueue: EmailQueueService,
  ) {}

  @Cron('1 0 * * *')
  async markLatePayments() {
    const result = await this.prisma.payment.updateMany({
      where: { status: PaymentStatus.PENDING, dueDate: { lt: new Date() } },
      data: { status: PaymentStatus.LATE },
    });
    this.logger.log(`Marked ${result.count} payments as Late.`);
  }

  @Cron('5 0 * * *')
  async expireContracts() {
    const expired = await this.prisma.contract.findMany({
      where: { status: ContractStatus.ACTIVE, endDate: { lt: new Date() } },
      include: { property: true },
    });

    for (const contract of expired) {
      await this.prisma.contract.update({
        where: { id: contract.id },
        data: { status: ContractStatus.EXPIRED },
      });

      await this.prisma.property.update({
        where: { id: contract.propertyId },
        data: { status: PropertyStatus.AVAILABLE },
      });

      await this.prisma.payment.updateMany({
        where: { contractId: contract.id, status: PaymentStatus.PENDING },
        data: { status: PaymentStatus.CANCELLED },
      });

      await this.prisma.notification.createMany({
        data: [
          {
            userId: contract.property.ownerId,
            type: 'contract_expired',
            title: 'Contrat expiré',
            body: `Le contrat pour "${contract.property.title}" a expiré.`,
          },
          {
            userId: contract.tenantId,
            type: 'contract_expired',
            title: 'Contrat expiré',
            body: 'Votre contrat de location a expiré.',
          },
        ],
      });
    }

    this.logger.log(`Expired ${expired.length} contracts.`);
  }

  @Cron('10 0 * * *')
  async sendLeaseExpiryAlerts() {
    const thresholds = [7, 15, 30];
    const now = new Date();

    for (const days of thresholds) {
      const target = addDays(now, days);
      const startOfTarget = new Date(target);
      startOfTarget.setHours(0, 0, 0, 0);
      const endOfTarget = new Date(target);
      endOfTarget.setHours(23, 59, 59, 999);

      const contracts = await this.prisma.contract.findMany({
        where: {
          status: ContractStatus.ACTIVE,
          endDate: { gte: startOfTarget, lte: endOfTarget },
        },
        include: { property: true },
      });

      for (const contract of contracts) {
        await this.prisma.notification.create({
          data: {
            userId: contract.property.ownerId,
            type: 'lease_expiring_soon',
            title: `Bail expirant dans ${days} jours`,
            body: `Le bail pour "${contract.property.title}" expire dans ${days} jours.`,
          },
        });
      }

      this.logger.log(`Sent ${contracts.length} expiry alerts for J-${days}.`);
    }
  }

  @Cron('20 0 * * *')
  async expireMandates() {
    const result = await this.prisma.mandate.updateMany({
      where: { status: MandateStatus.ACTIVE, endDate: { lt: new Date() }, deletedAt: null },
      data: { status: MandateStatus.EXPIRED },
    });
    this.logger.log(`Expired ${result.count} mandates.`);
  }

  @Cron('15 0 * * *')
  async sendPaymentAlerts() {
    const today = startOfDay(new Date());
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    let alertCount = 0;

    const configs = await this.prisma.paymentAlertConfig.findMany({
      where: { active: true },
      include: {
        user: { select: { id: true, email: true, firstName: true, lastName: true } },
      },
    });

    for (const config of configs) {
      // ── Pre-due alerts ───────────────────────────────────────────────────────
      const preDueDay = addDays(today, config.daysBeforeDue);
      const prePayments = await this.prisma.payment.findMany({
        where: {
          status: PaymentStatus.PENDING,
          dueDate: { gte: startOfDay(preDueDay), lte: endOfDay(preDueDay) },
          property: { ownerId: config.userId },
        },
        include: {
          tenant: { select: { firstName: true, lastName: true } },
          property: { select: { title: true } },
        },
      });

      for (const payment of prePayments) {
        if (await this.isSuppressed(config.userId, payment.tenantId, startOfMonth)) continue;
        await this.dispatchAlert(config.user, payment, 'pre', config.daysBeforeDue);
        alertCount++;
      }

      // ── Post-due (late) alerts ────────────────────────────────────────────────
      for (const daysLate of config.daysAfterDue) {
        const lateDueDay = addDays(today, -daysLate);
        const latePayments = await this.prisma.payment.findMany({
          where: {
            status: PaymentStatus.LATE,
            dueDate: { gte: startOfDay(lateDueDay), lte: endOfDay(lateDueDay) },
            property: { ownerId: config.userId },
          },
          include: {
            tenant: { select: { firstName: true, lastName: true } },
            property: { select: { title: true } },
          },
        });

        for (const payment of latePayments) {
          if (await this.isSuppressed(config.userId, payment.tenantId, startOfMonth)) continue;
          await this.dispatchAlert(config.user, payment, 'late', daysLate);
          alertCount++;
        }
      }
    }

    this.logger.log(`Sent ${alertCount} payment alerts.`);
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private async isSuppressed(ownerId: string, tenantId: string, since: Date): Promise<boolean> {
    const count = await this.prisma.notification.count({
      where: {
        userId: ownerId,
        type: { in: ['payment_alert_pre', 'payment_alert_late'] },
        body: { contains: tenantId },
        createdAt: { gte: since },
      },
    });
    return count >= 3;
  }

  private async dispatchAlert(
    owner: { id: string; email: string; firstName: string; lastName: string },
    payment: { tenantId: string; amount: number; period: string; dueDate: Date; tenant: { firstName: string; lastName: string }; property: { title: string } },
    kind: 'pre' | 'late',
    days: number,
  ): Promise<void> {
    const subject =
      kind === 'pre'
        ? `Rappel : loyer dû dans ${days} jour(s) — ${payment.property.title}`
        : `Retard de paiement : ${days} jour(s) — ${payment.property.title}`;

    const body = `${payment.tenant.firstName} ${payment.tenant.lastName} (${payment.tenantId}) — ${payment.property.title}`;

    await Promise.all([
      this.emailQueue.sendEmail({
        to: owner.email,
        subject,
        template: kind === 'pre' ? 'payment-alert-pre' : 'payment-alert-late',
        data: {
          ownerName: `${owner.firstName} ${owner.lastName}`,
          tenantName: `${payment.tenant.firstName} ${payment.tenant.lastName}`,
          propertyTitle: payment.property.title,
          amount: payment.amount,
          period: payment.period,
          daysBeforeDue: kind === 'pre' ? days : undefined,
          daysLate: kind === 'late' ? days : undefined,
        },
      }),
      this.prisma.notification.create({
        data: {
          userId: owner.id,
          type: kind === 'pre' ? 'payment_alert_pre' : 'payment_alert_late',
          title: subject,
          body,
        },
      }),
    ]);
  }
}
