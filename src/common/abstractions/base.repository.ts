import { NotFoundException } from '@nestjs/common';
import type { ICrudOperations } from '../interfaces/crud-operations.interface';
import type { PaginatedResult } from '../interfaces/paginated-result.interface';
import type { QueryField, ISearchRequest, SortClause } from '../interfaces/search-request.interface';
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

export abstract class BaseRepository<T, D extends object = Record<string, unknown>, TView = T>
  implements ICrudOperations<T, D, TView>
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

  async findById(id: string): Promise<TView | null> {
    return this.delegate.findUnique({ where: { id } }) as unknown as TView | null;
  }

  async findByIdOrThrow(id: string): Promise<TView> {
    const record = await this.findById(id);
    if (!record) throw new NotFoundException(`Resource with id "${id}" not found`);
    return record;
  }

  async findAll(
    request?: ISearchRequest,
    baseWhere: Record<string, unknown> = {},
  ): Promise<TView[]> {
    const where = this.buildSearchWhere(request ?? {}, baseWhere);
    return this.delegate.findMany({ where }) as unknown as TView[];
  }

  async create(data: D): Promise<TView> {
    return this.delegate.create({ data }) as unknown as TView;
  }

  async update(id: string, data: Partial<D>): Promise<TView> {
    return this.delegate.update({ where: { id }, data }) as unknown as TView;
  }

  async delete(id: string): Promise<void> {
    await this.delegate.delete({ where: { id } });
  }

  async findWithPagination(
    request: ISearchRequest,
    baseWhere: Record<string, unknown> = {},
  ): Promise<PaginatedResult<TView>> {
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

    return { data: data as unknown as TView[], meta: buildMeta(total, pageNumber, pageSize) };
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
    request: ISearchRequest,
    baseWhere: Record<string, unknown> = {},
    /** Overrides `this.queryFields` for this call only — e.g. to exclude a field from full-text search on a public route without affecting authenticated callers. */
    searchableFieldsOverride?: QueryField[],
  ): Record<string, unknown> {
    const where: Record<string, unknown> = { ...baseWhere };

    if (request.searchKey?.trim()) {
      const searchable = (searchableFieldsOverride ?? this.queryFields).filter((f) => f.searchable);
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
          case 'date-range': {
            const gte = values[0] ? new Date(values[0]) : undefined;
            const lte = values[1] ? new Date(values[1]) : undefined;
            if (gte !== undefined || lte !== undefined) {
              where[field.prismaField] = {
                ...(gte !== undefined ? { gte } : {}),
                ...(lte !== undefined ? { lte } : {}),
              };
            }
            break;
          }
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

  async count(request?: ISearchRequest): Promise<number> {
    const where = this.buildSearchWhere(request ?? {});
    return this.delegate.count({ where });
  }

  async exists(id: string): Promise<boolean> {
    const record = await this.findById(id);
    return record !== null;
  }
}
