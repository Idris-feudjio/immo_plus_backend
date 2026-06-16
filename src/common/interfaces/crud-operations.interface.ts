import type { PaginatedResult } from './paginated-result.interface';
import type { ISearchRequest } from './search-request.interface';

export interface ICrudOperations<T, D extends object = Record<string, unknown>, TView = T> {
  findById(id: string): Promise<TView | null>;
  findByIdOrThrow(id: string): Promise<TView>;
  findAll(request?: ISearchRequest, baseWhere?: Record<string, unknown>): Promise<TView[]>;
  findWithPagination(request: ISearchRequest, baseWhere?: Record<string, unknown>): Promise<PaginatedResult<TView>>;
  create(data: D): Promise<TView>;
  update(id: string, data: Partial<D>): Promise<TView>;
  delete(id: string): Promise<void>;
  count(request?: ISearchRequest): Promise<number>;
  exists(id: string): Promise<boolean>;
}
