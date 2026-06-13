import { Injectable } from '@nestjs/common';
import { Notification, NotificationPreference, PaymentAlertConfig } from '@prisma/client';
import { BaseService } from '../common/abstractions/base.service';
import type { PaginatedResult } from '../common/interfaces/paginated-result.interface';
import type { INotificationsService } from './interfaces/notification-service.interface';
import { NotificationCreateData, NotificationRepository } from './notification.repository';

@Injectable()
export class NotificationsService
  extends BaseService<Notification, NotificationCreateData>
  implements INotificationsService
{
  constructor(protected override readonly repository: NotificationRepository) {
    super(repository);
  }

  list(
    userId: string,
    query: { isRead?: boolean; type?: string; page?: number; limit?: number },
  ): Promise<PaginatedResult<Notification>> {
    return this.repository.findPaginated(userId, query);
  }

  markRead(userId: string, id: string): Promise<Notification> {
    return this.repository.markReadById(id, userId);
  }

  async markAllRead(userId: string): Promise<{ message: string }> {
    await this.repository.markAllReadByUser(userId);
    return { message: 'Toutes les notifications marquées comme lues.' };
  }

  async getCount(userId: string): Promise<{ count: number }> {
    const count = await this.repository.countUnread(userId);
    return { count };
  }

  getPreferences(userId: string): Promise<NotificationPreference> {
    return this.repository.findOrCreatePreferences(userId);
  }

  updatePreferences(
    userId: string,
    body: { email?: Record<string, boolean>; sms?: Record<string, boolean> },
  ): Promise<NotificationPreference> {
    return this.repository.upsertPreferences(userId, body);
  }

  upsertPaymentAlerts(
    userId: string,
    config: Record<string, unknown>,
  ): Promise<PaymentAlertConfig> {
    return this.repository.upsertPaymentAlerts(userId, config);
  }
}
