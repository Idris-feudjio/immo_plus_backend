import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly client: Redis;
  private readonly logger = new Logger(CacheService.name);

  private available = true;

  constructor(private readonly config: ConfigService) {
    this.client = new Redis({
      host: this.config.get<string>('redis.host', 'localhost'),
      port: this.config.get<number>('redis.port', 6379),
      password: this.config.get<string | undefined>('redis.password'),
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });

    this.client.on('error', (err: Error) => {
      if (this.available) {
        this.logger.warn(`Redis indisponible — cache désactivé (${err.message})`);
        this.available = false;
      }
    });

    this.client.on('connect', () => {
      this.available = true;
      this.logger.log('Redis connecté');
    });
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this.available) return null;
    try {
      const raw = await this.client.get(key);
      if (raw === null) return null;
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async set(key: string, value: unknown, ttl = 300): Promise<void> {
    if (!this.available) return;
    try {
      await this.client.setex(key, ttl, JSON.stringify(value));
    } catch { /* no-op */ }
  }

  async del(key: string): Promise<void> {
    if (!this.available) return;
    try {
      await this.client.del(key);
    } catch { /* no-op */ }
  }

  async delByPrefix(prefix: string): Promise<void> {
    if (!this.available) return;
    try {
      const keys = await this.client.keys(`${prefix}:*`);
      if (keys.length > 0) await this.client.del(...keys);
    } catch { /* no-op */ }
  }

  onModuleDestroy(): void {
    this.client.disconnect();
  }
}
