import type { Commission } from '@prisma/client';
import type { PaginatedResult } from '../../common/interfaces/paginated-result.interface';
import type { CreateCommissionDto, FilterCommissionsDto, PayCommissionDto } from '../dto/commission.dto';

export const COMMISSION_SERVICE = Symbol('COMMISSION_SERVICE');

export interface ICommissionService {
  create(userId: string, role: string, dto: CreateCommissionDto): Promise<Commission>;
  pay(id: string, userId: string, role: string, dto: PayCommissionDto): Promise<Commission>;
  cancel(id: string, userId: string, role: string): Promise<Commission>;
  list(userId: string, role: string, query: FilterCommissionsDto): Promise<PaginatedResult<Commission>>;
  getDashboard(userId: string, role: string): Promise<unknown>;
  getMyDue(userId: string): Promise<unknown>;
}
