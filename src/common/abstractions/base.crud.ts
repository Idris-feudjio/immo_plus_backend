import type { PaginatedResult } from '../interfaces/paginated-result.interface';
import type { SearchRequest } from '../interfaces/search-request.interface';

/**
 * Unified CRUD contract for the data-access and service layers.
 * Return types use Partial<T> so projected implementations (e.g. UserView)
 * remain assignable without an extra view-type parameter.
 */
export interface AbstractCrud<T, D extends object = Record<string, unknown>> {
  findById(id: string): Promise<Partial<T> | null>;
  findAll(request?: SearchRequest): Promise<Partial<T>[]>;
  findWithPagination(request: SearchRequest): Promise<PaginatedResult<Partial<T>>>;
  create(data: D): Promise<Partial<T>>;
  update(id: string, data: Partial<D>): Promise<Partial<T>>;
  delete(id: string): Promise<void>;
  count(request?: SearchRequest): Promise<number>;
  exists(id: string): Promise<boolean>;
}
