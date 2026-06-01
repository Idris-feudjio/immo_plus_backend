import { Payment } from '@prisma/client';
import type { PaginatedResult } from '../../common/interfaces/paginated-result.interface';
import type {
  CreatePaymentDto,
  FilterPaymentsDto,
  SendRemindersDto,
  UpdatePaymentDto,
} from '../dto/payment.dto';

export const PAYMENTS_SERVICE = 'IPaymentsService';

export interface IPaymentsService {
  list(
    userId: string,
    role: string,
    query: FilterPaymentsDto,
  ): Promise<PaginatedResult<Payment>>;
  create(userId: string, role: string, dto: CreatePaymentDto): Promise<Payment>;
  update(id: string, userId: string, role: string, dto: UpdatePaymentDto): Promise<Payment>;
  getOverdue(userId: string, role: string): Promise<{ data: Payment[] }>;
  sendReminders(
    userId: string,
    role: string,
    dto: SendRemindersDto,
  ): Promise<{ sent: number; channel: string }>;
  getStats(
    userId: string,
    role: string,
    query: { year?: number; month?: number; propertyId?: string },
  ): Promise<{
    totalCollected: number;
    totalPending: number;
    totalLate: number;
    collectionRate: number;
  }>;
  getReceiptUrl(id: string, userId: string, role: string): Promise<{ receiptUrl: string }>;
}
