import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly client: Redis;
  private readonly logger = new Logger(CacheService.name);

  constructor(private readonly config: ConfigService) {
    this.client = new Redis({
      host: this.config.get<string>('redis.host', 'localhost'),
      port: this.config.get<number>('redis.port', 6379),
      password: this.config.get<string | undefined>('redis.password'),
      lazyConnect: true,
    });

    this.client.on('error', (err: Error) => {
      this.logger.error(`Redis error: ${err.message}`);
    });
  }

  /** Retrieve a cached value. Returns null on cache miss. */
  async get<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(key);
    if (raw === null) return null;
    return JSON.parse(raw) as T;
  }

  /** Store a value with a TTL in seconds (default 300). */
  async set(key: string, value: unknown, ttl = 300): Promise<void> {
    await this.client.setex(key, ttl, JSON.stringify(value));
  }

  /** Delete a single key. */
  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  /** Delete all keys matching a prefix pattern (e.g. "properties" flushes "properties:*"). */
  async delByPrefix(prefix: string): Promise<void> {
    const keys = await this.client.keys(`${prefix}:*`);
    if (keys.length > 0) {
      await this.client.del(...keys);
    }
  }

  onModuleDestroy(): void {
    this.client.disconnect();
  }
}
