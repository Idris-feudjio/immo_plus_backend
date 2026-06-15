import type { PaginatedResult } from './paginated-result.interface';
import type { SearchRequest } from './search-request.interface';

export interface IService<T, D extends object = Record<string, unknown>, TView = T> {
  findById(id: string): Promise<TView | null>;
  findByIdOrThrow(id: string): Promise<TView>;
  findAll(request?: SearchRequest, baseWhere?: Record<string, unknown>): Promise<TView[]>;
  findWithPagination(request: SearchRequest, baseWhere?: Record<string, unknown>): Promise<PaginatedResult<TView>>;
  create(data: D): Promise<TView>;
  update(id: string, data: Partial<D>): Promise<TView>;
  delete(id: string): Promise<void>;
  count(request?: SearchRequest): Promise<number>;
  exists(id: string): Promise<boolean>;
}
