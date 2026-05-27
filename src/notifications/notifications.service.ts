import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { buildPaginationMeta } from '../common/dto/pagination.dto';

@Injectable()
export class NotificationsService {
  constructor(private prisma: PrismaService) {}

  async list(userId: string, query: { isRead?: boolean; type?: string; page?: number; limit?: number }) {
    const { page = 1, limit = 20, isRead, type } = query;
    const skip = (page - 1) * limit;

    const where: any = { userId };
    if (isRead !== undefined) where.isRead = isRead === true || isRead === ('true' as any);
    if (type) where.type = type;

    const [data, total] = await Promise.all([
      this.prisma.notification.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }),
      this.prisma.notification.count({ where }),
    ]);

    return { data, meta: buildPaginationMeta(total, page, limit) };
  }

  async markRead(userId: string, id: string) {
    return this.prisma.notification.update({
      where: { id, userId },
      data: { isRead: true },
    });
  }

  async markAllRead(userId: string) {
    await this.prisma.notification.updateMany({ where: { userId, isRead: false }, data: { isRead: true } });
    return { message: 'Toutes les notifications marquées comme lues.' };
  }

  async getCount(userId: string) {
    const count = await this.prisma.notification.count({ where: { userId, isRead: false } });
    return { count };
  }

  async getPreferences(userId: string) {
    let prefs = await this.prisma.notificationPreference.findUnique({ where: { userId } });
    if (!prefs) {
      prefs = await this.prisma.notificationPreference.create({
        data: { userId },
      });
    }
    return prefs;
  }

  async updatePreferences(userId: string, body: { email?: Record<string, boolean>; sms?: Record<string, boolean> }) {
    return this.prisma.notificationPreference.upsert({
      where: { userId },
      create: {
        userId,
        emailPrefs: body.email ?? {},
        smsPrefs: body.sms ?? {},
      },
      update: {
        emailPrefs: body.email ?? undefined,
        smsPrefs: body.sms ?? undefined,
      },
    });
  }

  async upsertPaymentAlerts(userId: string, config: any) {
    return this.prisma.paymentAlertConfig.upsert({
      where: { userId },
      create: { userId, ...config },
      update: config,
    });
  }

  async create(data: {
    userId: string;
    type: string;
    title: string;
    body: string;
    link?: string;
  }) {
    return this.prisma.notification.create({ data });
  }
}
