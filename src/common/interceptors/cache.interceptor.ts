import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { Observable, from, of } from 'rxjs';
import { switchMap, tap } from 'rxjs/operators';
import { CacheService } from '../../cache/cache.service';
import {
  CACHEABLE_KEY,
  CacheableOptions,
} from '../decorators/cacheable.decorator';
import { CACHE_EVICT_KEY, CacheEvictOptions } from '../decorators/cache-evict.decorator';

@Injectable()
export class CacheInterceptor implements NestInterceptor {
  constructor(
    private readonly cacheService: CacheService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const cacheable = this.reflector.get<CacheableOptions>(CACHEABLE_KEY, context.getHandler());
    const cacheEvict = this.reflector.get<CacheEvictOptions>(CACHE_EVICT_KEY, context.getHandler());

    if (cacheable) {
      const req = context.switchToHttp().getRequest<Request>();
      const cacheKey = `${cacheable.key}:${req.url}`;

      return from(this.cacheService.get<unknown>(cacheKey)).pipe(
        switchMap((cached) => {
          if (cached !== null) return of(cached);
          return next.handle().pipe(
            tap((data) => {
              this.cacheService
                .set(cacheKey, data, cacheable.ttl ?? 300)
                .catch(() => undefined);
            }),
          );
        }),
      );
    }

    if (cacheEvict) {
      return next.handle().pipe(
        tap(() => {
          this.cacheService.delByPrefix(cacheEvict.key).catch(() => undefined);
        }),
      );
    }

    return next.handle();
  }
}
