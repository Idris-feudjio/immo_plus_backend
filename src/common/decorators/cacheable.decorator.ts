import { SetMetadata } from '@nestjs/common';

export const CACHEABLE_KEY = 'cache:cacheable';

export interface CacheableOptions {
  /** Cache key prefix (e.g. "properties"). Combined with the request URL. */
  key: string;
  /** TTL in seconds. Defaults to 300. */
  ttl?: number;
}

/**
 * Marks a controller handler to be cached by CacheInterceptor.
 * Apply @UseInterceptors(CacheInterceptor) on the controller.
 *
 * @example
 * @Get()
 * @Cacheable({ key: 'properties', ttl: 300 })
 * findAll() { ... }
 */
export const Cacheable = (options: CacheableOptions) =>
  SetMetadata(CACHEABLE_KEY, options);
