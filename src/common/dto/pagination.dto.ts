import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsObject, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator';
import type { SearchRequest, SortClause } from '../interfaces/search-request.interface';

export class SortClauseDto implements SortClause {
  @ApiPropertyOptional()
  @IsString()
  fieldName!: string;

  @ApiPropertyOptional({ enum: ['ASC', 'DESC'] })
  @IsIn(['ASC', 'DESC'])
  direction!: 'ASC' | 'DESC';
}

export class PaginationDto implements SearchRequest {
  @ApiPropertyOptional({ default: 0, description: '0-based page index' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  pageNumber?: number = 0;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  searchKey?: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { type: 'array', items: { type: 'string' } },
  })
  @IsOptional()
  @IsObject()
  filters?: Record<string, string[]>;

  @ApiPropertyOptional({ type: [SortClauseDto] })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => SortClauseDto)
  sortClauses?: SortClauseDto[];
}
