import { Body, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { PaginationDto } from '../dto/pagination.dto';
import type { PaginatedResult } from '../interfaces/paginated-result.interface';
import { BaseService } from './base.service';

/**
 * Optional base controller that wires standard CRUD routes to a BaseService.
 * Return types use Partial<T> so projected overrides (e.g. UserView) remain
 * type-compatible without an extra view-type parameter.
 * Re-apply route decorators on every override so NestJS picks up the new metadata.
 */
export abstract class BaseController<T, D extends object = Record<string, unknown>> {
  constructor(protected readonly service: BaseService<T, D>) {}

  @Get()
  findAll(@Query() query: PaginationDto): Promise<PaginatedResult<Partial<T>>> {
    return this.service.findWithPagination(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string): Promise<Partial<T> | null> {
    return this.service.findById(id);
  }

  @Post()
  create(@Body() dto: D): Promise<Partial<T>> {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: Partial<D>): Promise<Partial<T>> {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string): Promise<void> {
    await this.service.delete(id);
  }
}
