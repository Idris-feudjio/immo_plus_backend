import type { AbstractCrud } from '../abstractions/base.crud';

/**
 * IRepository is now an alias for AbstractCrud.
 * Kept for backward compatibility — prefer AbstractCrud for new code.
 */
export type IRepository<T, D extends object = Record<string, unknown>> = AbstractCrud<T, D>;
