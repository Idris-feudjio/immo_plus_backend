export interface PaginationMeta {
  total: number;
  /** 0-based page index, mirrors SearchRequest.pageNumber. */
  pageNumber: number;
  pageSize: number;
  totalPages: number;
}

export interface PaginatedResult<T> {
  data: T[];
  meta: PaginationMeta;
}
