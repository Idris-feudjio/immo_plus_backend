import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { ContractStatus, PaymentStatus } from '@prisma/client';
import { addDays } from 'date-fns';

@Injectable()
export class CronService {
  private readonly logger = new Logger(CronService.name);

  constructor(private prisma: PrismaService) {}

  @Cron('1 0 * * *')
  async markLatePayments() {
    const result = await this.prisma.payment.updateMany({
      where: { status: PaymentStatus.Pending, dueDate: { lt: new Date() } },
      data: { status: PaymentStatus.Late },
    });
    this.logger.log(`Marked ${result.count} payments as Late.`);
  }

  @Cron('5 0 * * *')
  async expireContracts() {
    const expired = await this.prisma.contract.findMany({
      where: { status: ContractStatus.Active, endDate: { lt: new Date() } },
      include: { property: true },
    });

    for (const contract of expired) {
      await this.prisma.contract.update({
        where: { id: contract.id },
        data: { status: ContractStatus.Expired },
      });

      await this.prisma.property.update({
        where: { id: contract.propertyId },
        data: { status: 'Available' },
      });

      await this.prisma.payment.updateMany({
        where: { contractId: contract.id, status: PaymentStatus.Pending },
        data: { status: PaymentStatus.Cancelled },
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
      const startOfDay = new Date(target);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(target);
      endOfDay.setHours(23, 59, 59, 999);

      const contracts = await this.prisma.contract.findMany({
        where: {
          status: ContractStatus.Active,
          endDate: { gte: startOfDay, lte: endOfDay },
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
}
