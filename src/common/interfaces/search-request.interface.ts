export interface SortClause {
  fieldName: string;
  direction: 'ASC' | 'DESC';
}

/**
 * Generic query contract for all repository read operations.
 * pageNumber is 0-based; pageSize defaults to 10.
 */
export interface SearchRequest {
  /** Global full-text search across all fields marked searchable in QueryField[]. */
  searchKey?: string;
  /** Field-level filters: key = filterKey from QueryField, values = allowed set. */
  filters?: Record<string, string[]>;
  /** 0-based page index. Defaults to 0. */
  pageNumber?: number;
  /** Number of records per page. Defaults to 10. */
  pageSize?: number;
  /** Ordered list of sort instructions. */
  sortClauses?: SortClause[];
}

export type FilterType = 'exact' | 'contains' | 'in' | 'range' | 'boolean' | 'date-range';

/**
 * Maps a SearchRequest filter/search/sort key to a Prisma model field.
 * Declared once per repository in the constructor and drives buildSearchWhere / buildSearchOrderBy.
 */
export interface QueryField {
  /** Key used in SearchRequest.filters and SortClause.fieldName. */
  filterKey: string;
  /** Actual Prisma model field path (e.g. 'city', 'type'). */
  prismaField: string;
  /** Include in OR clause when searchKey is set. */
  searchable?: boolean;
  /** Accept in SearchRequest.filters. */
  filterable?: boolean;
  /** Accept in SearchRequest.sortClauses. */
  sortable?: boolean;
  /** How the filter value(s) map to a Prisma condition. Defaults to 'exact'. */
  filterType?: FilterType;
}
