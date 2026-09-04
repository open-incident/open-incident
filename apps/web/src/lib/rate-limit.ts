/**
 * Fixed-window counter — Redis when it is there, memory when it is not (a
 * single instance without Redis still gets a limit, per process).
 */
type Result = { allowed: boolean; remaining: number };

const memory = new Map<string, { count: number; resetAt: number }>();

let redis: import("ioredis").default | null | undefined;
async function client(): Promise<import("ioredis").default | null> {
  if (redis !== undefined) return redis;
  const url = process.env.REDIS_URL;
  if (!url) return (redis = null);
  try {
    const { default: IORedis } = await import("ioredis");
    redis = new IORedis(url, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      enableOfflineQueue: false,
    });
    redis.on("error", () => {});
    await redis.connect();
    return redis;
  } catch {
    return (redis = null);
  }
}

export async function rateLimit(key: string, max: number, windowSeconds: number): Promise<Result> {
  const r = await client();
  if (r) {
    try {
      const bucket = `rl:${key}:${Math.floor(Date.now() / (windowSeconds * 1000))}`;
      const count = await r.incr(bucket);
      if (count === 1) await r.expire(bucket, windowSeconds + 1);
      return { allowed: count <= max, remaining: Math.max(0, max - count) };
    } catch {
      /* fall through to memory */
    }
  }
  const now = Date.now();
  const entry = memory.get(key);
  if (!entry || entry.resetAt <= now) {
    memory.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return { allowed: true, remaining: max - 1 };
  }
  entry.count++;
  return { allowed: entry.count <= max, remaining: Math.max(0, max - entry.count) };
}
