/**
 * A read-only Opsgenie REST client.
 *
 * Every call is a GET: the migration never writes to Opsgenie, and the client
 * has no way to. It authenticates with `GenieKey`, talks to the EU or the US
 * region, waits and retries when Opsgenie answers 429 (exponential backoff,
 * `Retry-After` honoured when given), pages lists by offset 100 at a time, and
 * refuses to page past the 20 000 alerts Opsgenie lets a search reach — the
 * archive asks for date windows small enough instead (see windows.ts).
 *
 * `OPSGENIE_API_BASE` points both regions at another host (`<base>/eu`,
 * `<base>/us`): the development stack and the smoke suite use it to talk to a
 * mock. Production leaves it unset.
 */
import type {
  OgAlert,
  OgEscalation,
  OgHeartbeat,
  OgIntegration,
  OgNotificationRule,
  OgOverride,
  OgPaging,
  OgPolicy,
  OgRoutingRule,
  OgSchedule,
  OgTeam,
  OgTimeline,
  OgUser,
  Region,
} from "./types";

export const REGION_HOST: Record<Region, string> = {
  eu: "api.eu.opsgenie.com",
  us: "api.opsgenie.com",
};

/** The farthest an alert search may reach: offset + limit ≤ 20 000. */
export const SEARCH_CEILING = 20_000;
export const PAGE_SIZE = 100;

export function baseUrlFor(region: Region, override = process.env.OPSGENIE_API_BASE): string {
  const base = override?.trim().replace(/\/+$/, "");
  if (base) return `${base}/${region}`;
  return `https://${REGION_HOST[region]}`;
}

export type OpsgenieErrorCode =
  "unreachable" | "unauthorized" | "forbidden" | "not_found" | "throttled" | "invalid" | "server";

export class OpsgenieError extends Error {
  constructor(
    readonly code: OpsgenieErrorCode,
    readonly status: number | null,
    message: string,
  ) {
    super(message);
    this.name = "OpsgenieError";
  }
}

export type ClientOptions = {
  region: Region;
  key: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Injected in tests so a backoff does not take real seconds. */
  sleep?: (ms: number) => Promise<void>;
  /** Retries on 429 and 5xx before giving up. */
  maxRetries?: number;
  /** Called each time the client waits for Opsgenie's rate limit. */
  onThrottle?: (waitMs: number) => void;
  timeoutMs?: number;
};

type Query = Record<string, string | number | boolean | undefined>;

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Backoff for the n-th consecutive throttle (0-based), capped at 30 s. */
export function backoffMs(attempt: number, retryAfterHeader: string | null): number {
  const retryAfter = retryAfterHeader ? Number(retryAfterHeader) : NaN;
  if (Number.isFinite(retryAfter) && retryAfter >= 0) return Math.min(60_000, retryAfter * 1000);
  return Math.min(30_000, 500 * 2 ** attempt);
}

export class OpsgenieClient {
  readonly region: Region;
  private readonly base: string;
  private readonly key: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxRetries: number;
  private readonly onThrottle?: (waitMs: number) => void;
  private readonly timeoutMs: number;
  /** Requests made, for the progress label and the tests. */
  calls = 0;
  throttled = 0;

  constructor(opts: ClientOptions) {
    this.region = opts.region;
    this.base = opts.baseUrl ?? baseUrlFor(opts.region);
    this.key = opts.key.trim();
    this.fetchImpl = opts.fetch ?? fetch;
    this.sleep = opts.sleep ?? realSleep;
    this.maxRetries = opts.maxRetries ?? 8;
    this.onThrottle = opts.onThrottle;
    this.timeoutMs = opts.timeoutMs ?? 20_000;
  }

  /** The host shown to people: the region's, whatever the base points at. */
  get host(): string {
    return REGION_HOST[this.region];
  }

  /** One GET, retried on 429 / 5xx / network failure. Returns the parsed body. */
  async get<T = unknown>(path: string, query: Query = {}): Promise<T> {
    const url = new URL(this.base + path);
    for (const [k, v] of Object.entries(query))
      if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    let attempt = 0;
    for (;;) {
      let res: Response;
      try {
        this.calls += 1;
        res = await this.fetchImpl(url, {
          method: "GET",
          headers: { Authorization: `GenieKey ${this.key}`, Accept: "application/json" },
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (err) {
        if (attempt < Math.min(3, this.maxRetries)) {
          await this.sleep(backoffMs(attempt++, null));
          continue;
        }
        throw new OpsgenieError(
          "unreachable",
          null,
          `${this.host} could not be reached (${err instanceof Error ? err.message : String(err)})`,
        );
      }
      if (res.status === 429 || res.status >= 500) {
        if (attempt >= this.maxRetries) {
          throw new OpsgenieError(
            res.status === 429 ? "throttled" : "server",
            res.status,
            res.status === 429
              ? "Opsgenie kept refusing for its rate limit"
              : `Opsgenie answered ${res.status}`,
          );
        }
        const wait = backoffMs(attempt++, res.headers.get("retry-after"));
        if (res.status === 429) {
          this.throttled += 1;
          this.onThrottle?.(wait);
        }
        await res.body?.cancel().catch(() => {});
        await this.sleep(wait);
        continue;
      }
      const text = await res.text();
      let body: unknown = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = null;
      }
      if (!res.ok) {
        const said =
          body && typeof body === "object" && "message" in body
            ? String((body as { message: unknown }).message)
            : "";
        const message = said || `Opsgenie answered ${res.status}`;
        const code: OpsgenieErrorCode =
          res.status === 401
            ? "unauthorized"
            : res.status === 403
              ? "forbidden"
              : res.status === 404
                ? "not_found"
                : "invalid";
        throw new OpsgenieError(code, res.status, message);
      }
      return body as T;
    }
  }

  /** Every item of an offset-paged list, 100 at a time. */
  async listAll<T>(path: string, query: Query = {}, max = 10_000): Promise<T[]> {
    const out: T[] = [];
    for (let offset = 0; offset < max; offset += PAGE_SIZE) {
      const page = await this.get<{ data?: T[]; paging?: OgPaging; totalCount?: number }>(path, {
        ...query,
        limit: PAGE_SIZE,
        offset,
      });
      const items = page.data ?? [];
      out.push(...items);
      if (items.length < PAGE_SIZE || !page.paging?.next) break;
    }
    return out;
  }

  /* ---------- The endpoints the migration reads ---------- */

  account() {
    return this.get<{ data: { name: string; userCount?: number; plan?: { name?: string } } }>(
      "/v2/account",
    ).then((r) => r.data);
  }

  users() {
    return this.listAll<OgUser>("/v2/users", { sort: "username", order: "asc" });
  }

  /** First page only: enough to prove the key may read users. */
  usersProbe() {
    return this.get<{ data: OgUser[]; totalCount?: number }>("/v2/users", { limit: 1 });
  }

  teams() {
    return this.get<{ data: OgTeam[] }>("/v2/teams").then((r) => r.data ?? []);
  }

  team(id: string) {
    return this.get<{ data: OgTeam }>(`/v2/teams/${encodeURIComponent(id)}`, {
      identifierType: "id",
    }).then((r) => r.data);
  }

  routingRules(teamId: string) {
    return this.get<{ data: OgRoutingRule[] }>(
      `/v2/teams/${encodeURIComponent(teamId)}/routing-rules`,
      { teamIdentifierType: "id" },
    ).then((r) => r.data ?? []);
  }

  schedules() {
    return this.get<{ data: OgSchedule[] }>("/v2/schedules", { expand: "rotation" }).then(
      (r) => r.data ?? [],
    );
  }

  overrides(scheduleId: string) {
    return this.get<{ data: OgOverride[] }>(
      `/v2/schedules/${encodeURIComponent(scheduleId)}/overrides`,
      { scheduleIdentifierType: "id" },
    ).then((r) => r.data ?? []);
  }

  /** The schedule's final and base timelines over `weeks` weeks from `from`. */
  timeline(scheduleId: string, from: Date, weeks = 8) {
    return this.get<{ data: OgTimeline }>(
      `/v2/schedules/${encodeURIComponent(scheduleId)}/timeline`,
      {
        identifierType: "id",
        expand: "base",
        interval: weeks,
        intervalUnit: "weeks",
        date: from.toISOString(),
      },
    ).then((r) => r.data);
  }

  /** Who Opsgenie has on call at an instant, flattened to usernames. */
  onCalls(scheduleId: string, at: Date) {
    return this.get<{ data: { onCallRecipients?: string[] } }>(
      `/v2/schedules/${encodeURIComponent(scheduleId)}/on-calls`,
      { scheduleIdentifierType: "id", flat: true, date: at.toISOString() },
    ).then((r) => r.data?.onCallRecipients ?? []);
  }

  escalations() {
    return this.get<{ data: OgEscalation[] }>("/v2/escalations").then((r) => r.data ?? []);
  }

  notificationRules(userId: string) {
    return this.get<{ data: OgNotificationRule[] }>(
      `/v2/users/${encodeURIComponent(userId)}/notification-rules`,
    ).then((r) => r.data ?? []);
  }

  /** Alert policies of the account, then those of each team. */
  async policies(teamIds: string[]): Promise<OgPolicy[]> {
    const global = await this.get<{ data: OgPolicy[] }>("/v2/policies/alert")
      .then((r) => r.data ?? [])
      .catch(() => [] as OgPolicy[]);
    const out = [...global];
    for (const teamId of teamIds) {
      const own = await this.get<{ data: OgPolicy[] }>("/v2/policies", { teamId })
        .then((r) => r.data ?? [])
        .catch(() => [] as OgPolicy[]);
      out.push(...own.map((p) => ({ ...p, teamId })));
    }
    return out;
  }

  integrations() {
    return this.get<{ data: OgIntegration[] }>("/v2/integrations").then((r) => r.data ?? []);
  }

  heartbeats() {
    return this.get<{ data: { heartbeats?: OgHeartbeat[] } }>("/v2/heartbeats").then(
      (r) => r.data?.heartbeats ?? [],
    );
  }

  /** How many alerts a search matches. */
  countAlerts(query: string) {
    return this.get<{ data: { count: number } }>("/v2/alerts/count", { query }).then(
      (r) => r.data?.count ?? 0,
    );
  }

  /** One page of an alert search, oldest first unless told otherwise. */
  async searchAlerts(
    query: string,
    offset: number,
    limit = PAGE_SIZE,
    order: "asc" | "desc" = "asc",
  ): Promise<OgAlert[]> {
    if (offset + limit > SEARCH_CEILING)
      throw new OpsgenieError(
        "invalid",
        422,
        `An alert search reaches ${SEARCH_CEILING} alerts at most; ask for a smaller window`,
      );
    const r = await this.get<{ data: OgAlert[] }>("/v2/alerts", {
      query,
      offset,
      limit,
      sort: "createdAt",
      order,
    });
    return r.data ?? [];
  }

  alert(id: string) {
    return this.get<{ data: OgAlert }>(`/v2/alerts/${encodeURIComponent(id)}`, {
      identifierType: "id",
    }).then((r) => r.data);
  }
}

/** The Opsgenie search for alerts created in [from, to). */
export function windowQuery(from: Date, to: Date, extra?: string): string {
  const q = `createdAt>=${from.getTime()} AND createdAt<${to.getTime()}`;
  return extra ? `${q} AND ${extra}` : q;
}
