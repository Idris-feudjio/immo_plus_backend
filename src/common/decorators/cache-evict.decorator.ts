import { SetMetadata } from '@nestjs/common';

export const CACHE_EVICT_KEY = 'cache:evict';

export interface CacheEvictOptions {
  /** Key prefix whose entries will be flushed after the handler completes (e.g. "properties"). */
  key: string;
}

/**
 * Marks a controller handler to flush a cache prefix after execution.
 * Apply @UseInterceptors(CacheInterceptor) on the controller.
 *
 * @example
 * @Post()
 * @CacheEvict({ key: 'properties' })
 * create(@Body() dto: CreatePropertyDto) { ... }
 */
export const CacheEvict = (options: CacheEvictOptions) =>
  SetMetadata(CACHE_EVICT_KEY, options);
