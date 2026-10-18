import { and, eq, inArray } from "drizzle-orm";
import { incidents, members, withTenant } from "@openincident/db";
import { currentMember } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Seen within this window = reading now. The page beats every 20 s. */
const WINDOW_MS = 45_000;

/**
 * Who has the incident's post-mortem open right now. Each open page beats
 * (POST) and gets back the others seen in the last 45 s — the avatars and
 * "N reading now" of the post-incident strip. Kept in Redis when the instance
 * has it (one sorted set per incident, scored by the last beat), in this
 * process's memory otherwise; nothing is written to the database and a
 * reader who leaves simply ages out.
 */
const memory = new Map<string, Map<string, number>>();

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

async function beat(key: string, memberId: string, now: number): Promise<string[]> {
  const r = await client();
  if (r) {
    try {
      await r
        .multi()
        .zadd(key, now, memberId)
        .zremrangebyscore(key, 0, now - WINDOW_MS)
        .expire(key, 120)
        .exec();
      return await r.zrangebyscore(key, now - WINDOW_MS, "+inf");
    } catch {
      /* fall through to memory */
    }
  }
  // Without Redis the map lives in this process: drop incidents nobody reads any more.
  if (memory.size > 2_000)
    for (const [k, v] of memory)
      if ([...v.values()].every((at) => at < now - WINDOW_MS)) memory.delete(k);
  const seen = memory.get(key) ?? new Map<string, number>();
  seen.set(memberId, now);
  for (const [id, at] of seen) if (at < now - WINDOW_MS) seen.delete(id);
  memory.set(key, seen);
  return [...seen.keys()];
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const current = await currentMember();
  if (!current) return new Response("unauthorized", { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("not found", { status: 404 });
  const tenantId = current.tenant.id;
  const [inc] = await withTenant(tenantId, (tx) =>
    tx
      .select({ id: incidents.id })
      .from(incidents)
      .where(and(eq(incidents.tenantId, tenantId), eq(incidents.id, id))),
  );
  if (!inc) return new Response("not found", { status: 404 });
  const ids = (await beat(`presence:pm:${tenantId}:${inc.id}`, current.member.id, Date.now()))
    .filter((m) => m !== current.member.id)
    .slice(0, 12);
  const readers =
    ids.length === 0
      ? []
      : await withTenant(tenantId, (tx) =>
          tx
            .select({ id: members.id, name: members.name })
            .from(members)
            .where(and(eq(members.tenantId, tenantId), inArray(members.id, ids))),
        );
  return Response.json(
    { readers: readers.map((r) => ({ id: r.id, name: r.name })) },
    { headers: { "cache-control": "no-store" } },
  );
}
