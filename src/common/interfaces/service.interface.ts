import type { PaginatedResult } from './paginated-result.interface';
import type { SearchRequest } from './search-request.interface';

export interface IService<T, D extends object = Record<string, unknown>> {
  findById(id: string): Promise<T | null>;
  findAll(request?: SearchRequest, baseWhere?: Record<string, unknown>): Promise<T[]>;
  findWithPagination(request: SearchRequest, baseWhere?: Record<string, unknown>): Promise<PaginatedResult<T>>;
  create(data: D): Promise<T>;
  update(id: string, data: Partial<D>): Promise<T>;
  delete(id: string): Promise<void>;
  count(request?: SearchRequest): Promise<number>;
  exists(id: string): Promise<boolean>;
}
