import { NotFoundException } from '@nestjs/common';
import type { PaginatedResult } from '../interfaces/paginated-result.interface';
import type { IRepository } from '../interfaces/repository.interface';
import type { QueryField, SearchRequest, SortClause } from '../interfaces/search-request.interface';
import { buildMeta } from '../utils/pagination.util';

/**
 * Minimal Prisma model delegate interface required by BaseRepository.
 * Concrete repositories cast their Prisma delegate to this type in the constructor.
 */
export interface PrismaModelDelegate<T> {
  findUnique(args: { where: object; include?: object }): Promise<T | null>;
  findMany(args?: {
    where?: object;
    skip?: number;
    take?: number;
    orderBy?: object | object[];
    include?: object;
  }): Promise<T[]>;
  create(args: { data: object; include?: object }): Promise<T>;
  update(args: { where: object; data: object; include?: object }): Promise<T>;
  delete(args: { where: object }): Promise<T>;
  count(args?: { where?: object }): Promise<number>;
}

export abstract class BaseRepository<T, D extends object = Record<string, unknown>>
  implements IRepository<T, D>
{
  constructor(
    protected readonly delegate: PrismaModelDelegate<T>,
    /**
     * Declares which fields participate in search / filter / sort.
     * Drives buildSearchWhere() and buildSearchOrderBy().
     */
    protected readonly queryFields: QueryField[] = [],
  ) {}

  // ── Standard CRUD ───────────────────────────────────────────────────────────

  /** Find a single record by its primary key. Returns null if not found. */
  async findById(id: string): Promise<T | null> {
    return this.delegate.findUnique({ where: { id } });
  }

  /** Find by id, throwing NotFoundException if absent. */
  async findByIdOrThrow(id: string): Promise<T> {
    const record = await this.findById(id);
    if (!record) throw new NotFoundException(`Resource with id "${id}" not found`);
    return record;
  }

  /**
   * Return all records matching the search request.
   * Pass baseWhere to enforce invariant conditions (e.g. { deletedAt: null }).
   */
  async findAll(
    request?: SearchRequest,
    baseWhere: Record<string, unknown> = {},
  ): Promise<T[]> {
    const where = this.buildSearchWhere(request ?? {}, baseWhere);
    return this.delegate.findMany({ where });
  }

  /** Create a new record. */
  async create(data: D): Promise<T> {
    return this.delegate.create({ data });
  }

  /** Update a record by id. */
  async update(id: string, data: Partial<D>): Promise<T> {
    return this.delegate.update({ where: { id }, data });
  }

  /** Hard-delete a record by id. */
  async delete(id: string): Promise<void> {
    await this.delegate.delete({ where: { id } });
  }

  /**
   * Return a paginated result.
   * Pass baseWhere to enforce invariant conditions (e.g. { deletedAt: null }).
   */
  async findWithPagination(
    request: SearchRequest,
    baseWhere: Record<string, unknown> = {},
  ): Promise<PaginatedResult<T>> {
    const pageNumber = request.pageNumber ?? 0;
    const pageSize = request.pageSize ?? 10;
    const where = this.buildSearchWhere(request, baseWhere);
    const orderBy = this.buildSearchOrderBy(request.sortClauses);

    const [data, total] = await Promise.all([
      this.delegate.findMany({
        where,
        skip: pageNumber * pageSize,
        take: pageSize,
        orderBy: orderBy.length > 0 ? orderBy : undefined,
      }),
      this.delegate.count({ where }),
    ]);

    return { data, meta: buildMeta(total, pageNumber, pageSize) };
  }

  // ── Query helpers (available to concrete repositories) ─────────────────────

  /**
   * Translate a SearchRequest into a Prisma-compatible where object.
   *
   * - searchKey  → OR { contains: searchKey } over all searchable fields
   * - filters    → field condition per filterable QueryField
   * - baseWhere  → merged first (e.g. { deletedAt: null } for soft-delete models)
   */
  protected buildSearchWhere(
    request: SearchRequest,
    baseWhere: Record<string, unknown> = {},
  ): Record<string, unknown> {
    const where: Record<string, unknown> = { ...baseWhere };

    if (request.searchKey?.trim()) {
      const searchable = this.queryFields.filter((f) => f.searchable);
      if (searchable.length > 0) {
        where.OR = searchable.map((f) => ({
          [f.prismaField]: { contains: request.searchKey!.trim(), mode: 'insensitive' },
        }));
      }
    }

    if (request.filters) {
      for (const [key, values] of Object.entries(request.filters)) {
        if (!values?.length) continue;
        const field = this.queryFields.find((f) => f.filterKey === key && f.filterable);
        if (!field) continue;

        switch (field.filterType ?? 'exact') {
          case 'contains':
            where[field.prismaField] = { contains: values[0], mode: 'insensitive' };
            break;
          case 'in':
            where[field.prismaField] = { in: values };
            break;
          case 'range': {
            const gte = values[0] ? Number(values[0]) : undefined;
            const lte = values[1] ? Number(values[1]) : undefined;
            if (gte !== undefined || lte !== undefined) {
              where[field.prismaField] = {
                ...(gte !== undefined ? { gte } : {}),
                ...(lte !== undefined ? { lte } : {}),
              };
            }
            break;
          }
          case 'boolean':
            where[field.prismaField] = values[0] === 'true';
            break;
          default: // 'exact'
            where[field.prismaField] = values[0];
        }
      }
    }

    return where;
  }

  /**
   * Translate SortClause[] into a Prisma-compatible orderBy array.
   * Only clauses whose fieldName matches a sortable QueryField are included.
   */
  protected buildSearchOrderBy(
    sortClauses?: SortClause[],
  ): Record<string, 'asc' | 'desc'>[] {
    if (!sortClauses?.length) return [];

    return sortClauses.reduce<Record<string, 'asc' | 'desc'>[]>((acc, sc) => {
      const field = this.queryFields.find(
        (f) => (f.filterKey === sc.fieldName || f.prismaField === sc.fieldName) && f.sortable,
      );
      if (field) acc.push({ [field.prismaField]: sc.direction.toLowerCase() as 'asc' | 'desc' });
      return acc;
    }, []);
  }

  /** Count records matching the optional search request. */
  async count(request?: SearchRequest): Promise<number> {
    const where = this.buildSearchWhere(request ?? {});
    return this.delegate.count({ where });
  }

  /** Return true if a record with the given id exists. */
  async exists(id: string): Promise<boolean> {
    const record = await this.findById(id);
    return record !== null;
  }
}
