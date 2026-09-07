import { Global, HttpException, HttpStatus, Injectable, Module, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { createHash } from "node:crypto";
import Redis from "ioredis";

interface MemoryBucket {
  count: number;
  resetAt: number;
}

interface MemoryEphemeralValue {
  value: string;
  expiresAt: number;
}

export interface EphemeralConsumeAndMarkResult {
  status: "consumed" | "reused" | "missing";
  value: string | null;
}

const MAX_EPHEMERAL_TTL_SECONDS = 31 * 24 * 60 * 60;

@Injectable()
export class RedisSecurityService implements OnModuleInit, OnModuleDestroy {
  private client?: Redis;
  private readonly ephemeral = new Map<string, MemoryEphemeralValue>();

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

  async setEphemeral(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.assertEphemeralInput(key, value, ttlSeconds);
    if (this.client) {
      await this.client.set(key, value, "EX", ttlSeconds);
      return;
    }
    this.ephemeral.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
    this.pruneEphemeral();
  }

  async getEphemeral(key: string): Promise<string | null> {
    this.assertEphemeralKey(key);
    if (this.client) return this.client.get(key);
    const current = this.ephemeral.get(key);
    if (!current) return null;
    if (current.expiresAt <= Date.now()) {
      this.ephemeral.delete(key);
      return null;
    }
    return current.value;
  }

  async consumeEphemeral(key: string): Promise<string | null> {
    this.assertEphemeralKey(key);
    if (this.client) {
      const script = `
        local value = redis.call('GET', KEYS[1])
        if value then redis.call('DEL', KEYS[1]) end
        return value
      `;
      const result = await this.client.eval(script, 1, key);
      return typeof result === "string" ? result : null;
    }
    const current = this.ephemeral.get(key);
    this.ephemeral.delete(key);
    return current && current.expiresAt > Date.now() ? current.value : null;
  }

  async consumeAndMarkEphemeral(activeKey: string, usedKey: string, usedTtlSeconds: number): Promise<EphemeralConsumeAndMarkResult> {
    this.assertEphemeralKey(activeKey);
    this.assertEphemeralKey(usedKey);
    if (!Number.isInteger(usedTtlSeconds) || usedTtlSeconds < 1 || usedTtlSeconds > MAX_EPHEMERAL_TTL_SECONDS) {
      throw new Error("Ephemeral security TTL is invalid.");
    }
    if (this.client) {
      const script = `
        local active = redis.call('GET', KEYS[1])
        if active then
          redis.call('DEL', KEYS[1])
          redis.call('SET', KEYS[2], active, 'EX', ARGV[1])
          return {'consumed', active}
        end
        local used = redis.call('GET', KEYS[2])
        if used then return {'reused', used} end
        return {'missing', ''}
      `;
      const result = await this.client.eval(script, 2, activeKey, usedKey, String(usedTtlSeconds));
      if (!Array.isArray(result) || result.length < 2) throw new Error("Redis ephemeral rotation response is invalid.");
      const status = result[0];
      const value = result[1];
      if (status !== "consumed" && status !== "reused" && status !== "missing") {
        throw new Error("Redis ephemeral rotation status is invalid.");
      }
      return { status, value: typeof value === "string" && value ? value : null };
    }

    const now = Date.now();
    const active = this.ephemeral.get(activeKey);
    if (active && active.expiresAt > now) {
      this.ephemeral.delete(activeKey);
      this.ephemeral.set(usedKey, { value: active.value, expiresAt: now + usedTtlSeconds * 1000 });
      this.pruneEphemeral();
      return { status: "consumed", value: active.value };
    }
    if (active) this.ephemeral.delete(activeKey);
    const used = this.ephemeral.get(usedKey);
    if (used && used.expiresAt > now) return { status: "reused", value: used.value };
    if (used) this.ephemeral.delete(usedKey);
    return { status: "missing", value: null };
  }

  async deleteEphemeral(key: string): Promise<void> {
    this.assertEphemeralKey(key);
    if (this.client) {
      await this.client.del(key);
      return;
    }
    this.ephemeral.delete(key);
  }

  private assertEphemeralInput(key: string, value: string, ttlSeconds: number): void {
    this.assertEphemeralKey(key);
    if (!value || value.length > 65536) throw new Error("Ephemeral security value is invalid.");
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > MAX_EPHEMERAL_TTL_SECONDS) throw new Error("Ephemeral security TTL is invalid.");
  }

  private assertEphemeralKey(key: string): void {
    if (!key.startsWith("carepoint:") || key.length > 300) throw new Error("Ephemeral security key is invalid.");
  }

  private pruneEphemeral(): void {
    if (this.ephemeral.size < 5000) return;
    const now = Date.now();
    for (const [key, item] of this.ephemeral) {
      if (item.expiresAt <= now) this.ephemeral.delete(key);
    }
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
