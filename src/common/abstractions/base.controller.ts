import { Body, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { PaginationDto } from '../dto/pagination.dto';
import type { PaginatedResult } from '../interfaces/paginated-result.interface';
import type { AbstractCrud } from './base.crud';
import { BaseService } from './base.service';

/**
 * Optional base controller that wires standard CRUD routes to a BaseService.
 * Implements AbstractCrud so the HTTP layer shares the same contract as the
 * repository and service layers.
 * Return types use Partial<T> so projected overrides (e.g. UserView) remain
 * assignable without an extra view-type parameter.
 * Re-apply route decorators on every override so NestJS picks up the new metadata.
 */
export abstract class BaseController<T, D extends object = Record<string, unknown>>
  implements AbstractCrud<T, D>
{
  constructor(protected readonly service: BaseService<T, D>) {}

  @Post('search')
  findWithPagination(@Body() body: PaginationDto): Promise<PaginatedResult<Partial<T>>> {
    return this.service.findWithPagination(body);
  }

  @Post('search-all')
  findAll(@Body() query: PaginationDto): Promise<Partial<T>[]> {
    return this.service.findAll(query);
  }

  @Get(':id/detail')
  findById(@Param('id') id: string): Promise<Partial<T> | null> {
    return this.service.findById(id);
  }

  @Post('create')
  create(@Body() dto: D): Promise<Partial<T>> {
    return this.service.create(dto);
  }

  @Patch(':id/update')
  update(@Param('id') id: string, @Body() dto: Partial<D>): Promise<Partial<T>> {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(@Param('id') id: string): Promise<void> {
    return this.service.delete(id);
  }

  @Get(':id/exists')
  exists(@Param('id') id: string): Promise<boolean> {
    return this.service.exists(id);
  }

  @Post('count')
  count(@Body() query: PaginationDto): Promise<number> {
    return this.service.count(query);
  }
}
