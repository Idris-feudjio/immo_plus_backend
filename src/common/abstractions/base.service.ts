import type { PaginatedResult } from '../interfaces/paginated-result.interface';
import type { IService } from '../interfaces/service.interface';
import type { SearchRequest } from '../interfaces/search-request.interface';
import { BaseRepository } from './base.repository';

export abstract class BaseService<T, D extends object = Record<string, unknown>>
  implements IService<T, D>
{
  constructor(protected readonly repository: BaseRepository<T, D>) {}

  findById(id: string): Promise<T | null> {
    return this.repository.findById(id);
  }

  findAll(request?: SearchRequest, baseWhere?: Record<string, unknown>): Promise<T[]> {
    return this.repository.findAll(request, baseWhere);
  }

  findWithPagination(
    request: SearchRequest,
    baseWhere?: Record<string, unknown>,
  ): Promise<PaginatedResult<T>> {
    return this.repository.findWithPagination(request, baseWhere);
  }

  create(data: D): Promise<T> {
    return this.repository.create(data);
  }

  update(id: string, data: Partial<D>): Promise<T> {
    return this.repository.update(id, data);
  }

  async delete(id: string): Promise<void> {
    await this.repository.delete(id);
  }

  count(request?: SearchRequest): Promise<number> {
    return this.repository.count(request);
  }

  exists(id: string): Promise<boolean> {
    return this.repository.exists(id);
  }
}
