import { Injectable } from '@nestjs/common';
import {
  Notification,
  NotificationPreference,
  PaymentAlertConfig,
} from '@prisma/client';
import {
  BaseRepository,
  PrismaModelDelegate,
} from '../common/abstractions/base.repository';
import type { PaginatedResult } from '../common/interfaces/paginated-result.interface';
import type { QueryField, ISearchRequest } from '../common/interfaces/search-request.interface';
import { PrismaService } from '../prisma/prisma.service';

export type NotificationCreateData = {
  userId: string;
  type: string;
  title: string;
  body: string;
  link?: string;
};

const NOTIFICATION_QUERY_FIELDS: QueryField[] = [
  { filterKey: 'type',      prismaField: 'type',      filterable: true, filterType: 'exact' },
  { filterKey: 'isRead',    prismaField: 'isRead',    filterable: true, filterType: 'boolean' },
  { filterKey: 'createdAt', prismaField: 'createdAt', sortable: true },
];

@Injectable()
export class NotificationRepository extends BaseRepository<Notification, NotificationCreateData> {
  constructor(private readonly prisma: PrismaService) {
    super(
      prisma.notification as unknown as PrismaModelDelegate<Notification>,
      NOTIFICATION_QUERY_FIELDS,
    );
  }

  /** Paginated list scoped to a user, with optional isRead/type filters. */
  findPaginated(
    userId: string,
    query: { isRead?: boolean; type?: string; page?: number; limit?: number },
  ): Promise<PaginatedResult<Notification>> {
    const { page = 1, limit = 20, isRead, type } = query;
    const filters: Record<string, string[]> = {};
    if (isRead !== undefined) filters.isRead = [String(isRead)];
    if (type) filters.type = [type];

    const request: ISearchRequest = {
      filters,
      pageNumber: page - 1,
      pageSize: limit,
      sortClauses: [{ fieldName: 'createdAt', direction: 'DESC' }],
    };

    return this.findWithPagination(request, { userId });
  }

  /** Mark one notification as read, scoped by userId for security. */
  markReadById(id: string, userId: string): Promise<Notification> {
    return this.prisma.notification.update({
      where: { id, userId },
      data: { isRead: true },
    });
  }

  async markAllReadByUser(userId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
  }

  countUnread(userId: string): Promise<number> {
    return this.prisma.notification.count({ where: { userId, isRead: false } });
  }

  async findOrCreatePreferences(userId: string): Promise<NotificationPreference> {
    const existing = await this.prisma.notificationPreference.findUnique({ where: { userId } });
    if (existing) return existing;
    return this.prisma.notificationPreference.create({ data: { userId } });
  }

  upsertPreferences(
    userId: string,
    body: { email?: Record<string, boolean>; sms?: Record<string, boolean> },
  ): Promise<NotificationPreference> {
    return this.prisma.notificationPreference.upsert({
      where: { userId },
      create: { userId, emailPrefs: body.email ?? {}, smsPrefs: body.sms ?? {} },
      update: {
        ...(body.email !== undefined ? { emailPrefs: body.email } : {}),
        ...(body.sms !== undefined ? { smsPrefs: body.sms } : {}),
      },
    });
  }

  upsertPaymentAlerts(
    userId: string,
    config: Record<string, unknown>,
  ): Promise<PaymentAlertConfig> {
    return this.prisma.paymentAlertConfig.upsert({
      where: { userId },
      create: { userId, ...config } as never,
      update: config as never,
    });
  }
}
