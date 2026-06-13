import { Contract } from '@prisma/client';
import type { PaginatedResult } from '../../common/interfaces/paginated-result.interface';
import type {
  CreateContractDto,
  FilterContractsDto,
  RenewContractDto,
  TerminateContractDto,
} from '../dto/contract.dto';

export const CONTRACTS_SERVICE = 'IContractsService';

export interface IContractsService {
  list(
    userId: string,
    role: string,
    query: FilterContractsDto,
  ): Promise<PaginatedResult<Contract>>;
  create(userId: string, role: string, dto: CreateContractDto): Promise<Contract>;
  getById(id: string, userId: string, role: string): Promise<Contract>;
  renew(id: string, userId: string, role: string, dto: RenewContractDto): Promise<Contract>;
  terminate(
    id: string,
    userId: string,
    role: string,
    dto: TerminateContractDto,
  ): Promise<{ message: string }>;
  getPdfUrl(id: string, userId: string, role: string, force?: boolean): Promise<{ pdfUrl: string }>;
  generateReceipts(
    id: string,
    userId: string,
    role: string,
    period: string,
  ): Promise<{ generated: number; message: string }>;
}
