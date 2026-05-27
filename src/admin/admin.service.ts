import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentStatus } from '@prisma/client';

@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService) {}

  async getGlobalStats() {
    const [users, properties, contracts, paymentVolume] = await Promise.all([
      this.prisma.user.groupBy({ by: ['role'], _count: true }),
      this.prisma.property.aggregate({
        where: { deletedAt: null },
        _count: true,
      }),
      this.prisma.contract.count({ where: { status: 'Active' } }),
      this.prisma.payment.aggregate({
        where: { status: PaymentStatus.Paid },
        _sum: { amount: true },
      }),
    ]);

    const publishedProps = await this.prisma.property.count({ where: { isPublished: true, deletedAt: null } });
    const roleMap = Object.fromEntries(users.map((u) => [u.role, u._count]));
    const totalUsers = Object.values(roleMap).reduce((s: number, c: any) => s + c, 0);

    return {
      users: {
        total: totalUsers,
        owners: roleMap['owner'] ?? 0,
        tenants: roleMap['tenant'] ?? 0,
        managers: roleMap['manager'] ?? 0,
        admins: roleMap['admin'] ?? 0,
      },
      properties: { total: properties._count, published: publishedProps },
      contracts: { active: contracts },
      monthlyPaymentVolume: paymentVolume._sum.amount ?? 0,
    };
  }

  async getSettings() {
    let settings = await this.prisma.adminSettings.findFirst();
    if (!settings) {
      settings = await this.prisma.adminSettings.create({ data: {} });
    }
    return settings;
  }

  async updateSettings(body: any) {
    const existing = await this.prisma.adminSettings.findFirst();
    if (!existing) {
      return this.prisma.adminSettings.create({ data: body });
    }
    return this.prisma.adminSettings.update({ where: { id: existing.id }, data: body });
  }
}
