import {
  Notification,
  NotificationPreference,
  PaymentAlertConfig,
} from '@prisma/client';
import type { PaginatedResult } from '../../common/interfaces/paginated-result.interface';

export const NOTIFICATIONS_SERVICE = 'INotificationsService';

export interface INotificationsService {
  list(
    userId: string,
    query: { isRead?: boolean; type?: string; page?: number; limit?: number },
  ): Promise<PaginatedResult<Notification>>;
  markRead(userId: string, id: string): Promise<Notification>;
  markAllRead(userId: string): Promise<{ message: string }>;
  getCount(userId: string): Promise<{ count: number }>;
  getPreferences(userId: string): Promise<NotificationPreference>;
  updatePreferences(
    userId: string,
    body: { email?: Record<string, boolean>; sms?: Record<string, boolean> },
  ): Promise<NotificationPreference>;
  upsertPaymentAlerts(
    userId: string,
    config: Record<string, unknown>,
  ): Promise<PaymentAlertConfig>;
  create(data: {
    userId: string;
    type: string;
    title: string;
    body: string;
    link?: string;
  }): Promise<Notification>;
}
