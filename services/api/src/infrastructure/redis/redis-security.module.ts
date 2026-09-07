import { Global, HttpException, HttpStatus, Injectable, Module, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { createHash } from "node:crypto";
import Redis from "ioredis";

interface MemoryBucket {
  count: number;
  resetAt: number;
}

@Injectable()
export class RedisSecurityService implements OnModuleInit, OnModuleDestroy {
  private client?: Redis;

  async onModuleInit(): Promise<void> {
    const url = process.env.REDIS_URL?.trim();
    if (!url) {
      if (process.env.NODE_ENV === "production") throw new Error("REDIS_URL is required in production for distributed security controls.");
      return;
    }
    this.client = new Redis(url, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: Number(process.env.REDIS_CONNECT_TIMEOUT_MS ?? 3000),
    });
    await this.client.connect();
    await this.client.ping();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) await this.client.quit().catch(() => undefined);
  }

  get connected(): boolean {
    return this.client?.status === "ready";
  }

  async ping(): Promise<boolean> {
    if (!this.client) return process.env.NODE_ENV !== "production";
    try {
      return (await this.client.ping()) === "PONG";
    } catch {
      return false;
    }
  }

  async consume(key: string, windowSeconds: number): Promise<{ count: number; ttlSeconds: number } | null> {
    if (!this.client) return null;
    const script = `
      local count = redis.call('INCR', KEYS[1])
      if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
      local ttl = redis.call('TTL', KEYS[1])
      return {count, ttl}
    `;
    const result = await this.client.eval(script, 1, key, String(windowSeconds));
    if (!Array.isArray(result) || result.length < 2) throw new Error("Redis rate-limit response is invalid.");
    return { count: Number(result[0]), ttlSeconds: Math.max(1, Number(result[1])) };
  }
}

@Injectable()
export class DistributedRateLimitService {
  private readonly memory = new Map<string, MemoryBucket>();

  constructor(private readonly redis: RedisSecurityService) {}

  async assertAllowed(input: {
    namespace: string;
    identity: string;
    limit: number;
    windowSeconds: number;
  }): Promise<void> {
    const namespace = input.namespace.replace(/[^a-zA-Z0-9:_-]/g, "").slice(0, 80);
    if (!namespace || !input.identity || input.limit < 1 || input.windowSeconds < 1) throw new Error("Invalid rate-limit policy.");
    const digest = createHash("sha256").update(input.identity).digest("hex");
    const key = `carepoint:rl:${namespace}:${digest}`;
    const distributed = await this.redis.consume(key, input.windowSeconds);
    const state = distributed ?? this.consumeMemory(key, input.windowSeconds);
    if (state.count > input.limit) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: "Too many requests. Retry after the current security window.",
          retryAfterSeconds: state.ttlSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private consumeMemory(key: string, windowSeconds: number): { count: number; ttlSeconds: number } {
    const now = Date.now();
    const current = this.memory.get(key);
    if (!current || current.resetAt <= now) {
      const resetAt = now + windowSeconds * 1000;
      this.memory.set(key, { count: 1, resetAt });
      this.pruneMemory(now);
      return { count: 1, ttlSeconds: windowSeconds };
    }
    current.count += 1;
    return { count: current.count, ttlSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) };
  }

  private pruneMemory(now: number): void {
    if (this.memory.size < 5000) return;
    for (const [key, bucket] of this.memory) {
      if (bucket.resetAt <= now) this.memory.delete(key);
    }
  }
}

@Global()
@Module({
  providers: [RedisSecurityService, DistributedRateLimitService],
  exports: [RedisSecurityService, DistributedRateLimitService],
})
export class RedisSecurityModule {}
