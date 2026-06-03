import type { PaginatedResult } from '../interfaces/paginated-result.interface';
import type { IRepository } from '../interfaces/repository.interface';
import type { SearchRequest } from '../interfaces/search-request.interface';

/**
 * Optional base service that delegates CRUD to an IRepository.
 * Return types mirror AbstractCrud (Partial<T>) so projected subclass
 * overrides (e.g. returning UserView instead of User) remain type-compatible.
 */
export abstract class BaseService<T, D extends object = Record<string, unknown>> {
  constructor(protected readonly repository: IRepository<T, D>) {}

  findById(id: string): Promise<Partial<T> | null> {
    return this.repository.findById(id);
  }

  findAll(request?: SearchRequest): Promise<Partial<T>[]> {
    return this.repository.findAll(request);
  }

  create(data: D): Promise<Partial<T>> {
    return this.repository.create(data);
  }

  update(id: string, data: Partial<D>): Promise<Partial<T>> {
    return this.repository.update(id, data);
  }

  async delete(id: string): Promise<void> {
    await this.repository.delete(id);
  }

  findWithPagination(request: SearchRequest): Promise<PaginatedResult<Partial<T>>> {
    return this.repository.findWithPagination(request);
  }

  count(request?: SearchRequest): Promise<number> {
    return this.repository.count(request);
  }

  exists(id: string): Promise<boolean> {
    return this.repository.exists(id);
  }
}
