import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ContractStatus, PaymentStatus, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
interface ListUsersQuery {
  page?: number;
  limit?: number;
  role?: Role;
  isActive?: boolean;
  search?: string;
}

const USER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  role: true,
  avatarUrl: true,
  emailVerified: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

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
      this.prisma.contract.count({ where: { status: ContractStatus.ACTIVE } }),
      this.prisma.payment.aggregate({
        where: { status: PaymentStatus.PAID },
        _sum: { amount: true },
      }),
    ]);

    const publishedProps = await this.prisma.property.count({ where: { isPublished: true, deletedAt: null } });
    const roleMap = Object.fromEntries(users.map((u) => [u.role, u._count]));
    const totalUsers = Object.values(roleMap).reduce((s: number, c: any) => s + c, 0);

    return {
      users: {
        total: totalUsers,
        owners: roleMap[Role.OWNER] ?? 0,
        tenants: roleMap[Role.TENANT] ?? 0,
        managers: roleMap[Role.MANAGER] ?? 0,
        admins: roleMap[Role.ADMIN] ?? 0,
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

  async listUsers(query: ListUsersQuery) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 10));
    const skip = (page - 1) * limit;

    const where: Prisma.UserWhereInput = {};
    if (query.role !== undefined) where.role = query.role;
    if (query.isActive !== undefined) where.isActive = query.isActive;
    if (query.search) {
      where.OR = [
        { firstName: { contains: query.search, mode: 'insensitive' } },
        { lastName: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        select: USER_SELECT,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async deactivateUser(id: string) {
    const existing = await this.prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new NotFoundException('USER_NOT_FOUND');
    return this.prisma.user.update({
      where: { id },
      data: { isActive: false },
      select: USER_SELECT,
    });
  }
}
