import type { Mandate } from '@prisma/client';
import type { PaginatedResult } from '../../common/interfaces/paginated-result.interface';
import type { CreateMandateDto, ListMandatesDto, TerminateMandateDto } from '../dto/mandate.dto';

export const MANDATE_SERVICE = 'IMandateService';

export interface IMandateService {
  create(userId: string, role: string, dto: CreateMandateDto): Promise<Mandate>;
  terminate(id: string, userId: string, role: string, dto: TerminateMandateDto): Promise<Mandate>;
  list(userId: string, role: string, query: ListMandatesDto): Promise<PaginatedResult<Mandate>>;
}
