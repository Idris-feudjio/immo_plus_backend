import { PaginationDto } from '../dto/pagination.dto';
import type { PaginatedResult } from '../interfaces/paginated-result.interface';


export interface AbstractCrud<T, D extends object = Record<string, unknown>> {
  create(data: Partial<D>): Promise<T>;
  search(query: PaginationDto): Promise<PaginatedResult<T>>;
  searchAll(query: PaginationDto): Promise<T[]>;
  findById(id: string): Promise<T | null>;
  update(id: string, data: Partial<D>): Promise<T>;
  delete(id: string): Promise<void>;
  count(query: PaginationDto): Promise<number>;
  exists(id: string): Promise<boolean>;
}
