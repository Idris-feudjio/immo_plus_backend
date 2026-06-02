import type { PaginatedResult } from '../interfaces/paginated-result.interface';
import type { SearchRequest } from '../interfaces/search-request.interface';

/**
 * Unified CRUD contract for the repository layer.
 * BaseRepository implements this — BaseService and BaseController consume it
 * but do not implement it (different layer, different role).
 *
 * Uses SearchRequest as query type: PaginationDto implements it, so passing
 * a PaginationDto anywhere a SearchRequest is expected is always valid.
 */
export interface AbstractCrud<T, D extends object = Record<string, unknown>> {
  findById(id: string): Promise<T | null>;
  findAll(request?: SearchRequest): Promise<T[]>;
  findWithPagination(request: SearchRequest): Promise<PaginatedResult<T>>;
  create(data: D): Promise<T>;
  update(id: string, data: Partial<D>): Promise<T>;
  delete(id: string): Promise<T>;
  count(request?: SearchRequest): Promise<number>;
  exists(id: string): Promise<boolean>;
}
