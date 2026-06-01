import type { PaginationMeta } from '../interfaces/paginated-result.interface';

/**
 * Build pagination metadata.
 * @param total   Total number of matching records.
 * @param pageNumber 0-based page index (mirrors SearchRequest.pageNumber).
 * @param pageSize   Records per page.
 */
export function buildMeta(total: number, pageNumber: number, pageSize: number): PaginationMeta {
  return {
    total,
    pageNumber,
    pageSize,
    totalPages: pageSize > 0 ? Math.ceil(total / pageSize) : 0,
  };
}
