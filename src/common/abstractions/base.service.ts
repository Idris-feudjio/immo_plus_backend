import type { PaginatedResult } from '../interfaces/paginated-result.interface';
import type { IService } from '../interfaces/service.interface';
import type { SearchRequest } from '../interfaces/search-request.interface';
import { BaseRepository } from './base.repository';

export abstract class BaseService<T, D extends object = Record<string, unknown>, TView = T>
  implements IService<T, D, TView>
{
  constructor(protected readonly repository: BaseRepository<T, D, TView>) {}

  findById(id: string): Promise<TView | null> {
    return this.repository.findById(id);
  }

  findByIdOrThrow(id: string): Promise<TView> {
    return this.repository.findByIdOrThrow(id);
  }

  findAll(request?: SearchRequest, baseWhere?: Record<string, unknown>): Promise<TView[]> {
    return this.repository.findAll(request, baseWhere);
  }

  findWithPagination(
    request: SearchRequest,
    baseWhere?: Record<string, unknown>,
  ): Promise<PaginatedResult<TView>> {
    return this.repository.findWithPagination(request, baseWhere);
  }

  create(data: D): Promise<TView> {
    return this.repository.create(data);
  }

  async update(id: string, data: Partial<D>): Promise<TView> {
    await this.findByIdOrThrow(id);
    return this.repository.update(id, data);
  }

  async delete(id: string): Promise<void> {
    await this.findByIdOrThrow(id);
    await this.repository.delete(id);
  }

  count(request?: SearchRequest): Promise<number> {
    return this.repository.count(request);
  }

  exists(id: string): Promise<boolean> {
    return this.repository.exists(id);
  }
}
