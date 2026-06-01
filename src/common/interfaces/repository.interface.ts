import type { PaginatedResult } from './paginated-result.interface';
import type { SearchRequest } from './search-request.interface';

export interface IRepository<T, D extends object = Record<string, unknown>> {
  findById(id: string): Promise<T | null>;
  findAll(request?: SearchRequest): Promise<T[]>;
  create(data: D): Promise<T>;
  update(id: string, data: Partial<D>): Promise<T>;
  delete(id: string): Promise<T>;
  findWithPagination(request: SearchRequest): Promise<PaginatedResult<T>>;
}
