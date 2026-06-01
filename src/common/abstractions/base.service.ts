import type { PaginatedResult } from '../interfaces/paginated-result.interface';
import type { IRepository } from '../interfaces/repository.interface';
import type { SearchRequest } from '../interfaces/search-request.interface';

/**
 * Optional base service that delegates CRUD to an IRepository.
 * Extend this when a service has no special logic beyond basic operations.
 */
export abstract class BaseService<T, D extends object = Record<string, unknown>> {
  constructor(protected readonly repository: IRepository<T, D>) {}

  findById(id: string): Promise<T | null> {
    return this.repository.findById(id);
  }

  findAll(request?: SearchRequest): Promise<T[]> {
    return this.repository.findAll(request);
  }

  create(data: D): Promise<T> {
    return this.repository.create(data);
  }

  update(id: string, data: Partial<D>): Promise<T> {
    return this.repository.update(id, data);
  }

  delete(id: string): Promise<T> {
    return this.repository.delete(id);
  }

  findWithPagination(request: SearchRequest): Promise<PaginatedResult<T>> {
    return this.repository.findWithPagination(request);
  }
}
