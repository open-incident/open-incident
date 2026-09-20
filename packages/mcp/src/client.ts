/**
 * The thin HTTP client the MCP tools call.
 *
 * The server talks to the **public REST API**, never to the database. That is
 * the whole design: an assistant reaching a workspace inherits the API key's
 * scopes, its rate limit and its tenant isolation, and cannot reach round the
 * escalation rules. It also means one server works against the hosted product
 * and against somebody's self-hosted instance, with nothing but a URL and a
 * key — and that anything the assistant can do, a person could have done with
 * curl and the same key.
 */

export type ClientConfig = {
  /** Workspace root, e.g. https://skylark.open-incident.com */
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class IncidentClient {
  private readonly root: string;

  constructor(private readonly config: ClientConfig) {
    // Both "https://skylark…" and "https://skylark…/api/v1" are tolerated:
    // people paste whichever they had in front of them, and being strict would
    // only produce a 404 they have to guess at.
    //
    // A loop rather than `replace(/\/+$/, "")`: anchored at the end, that
    // expression still makes the engine try every starting position, which is
    // quadratic on a long run of slashes. Removing them one at a time is
    // linear and reads just as well.
    let trimmed = config.baseUrl;
    while (trimmed.endsWith("/")) trimmed = trimmed.slice(0, -1);
    this.root = trimmed.endsWith("/api/v1") ? trimmed : `${trimmed}/api/v1`;
  }

  async request<T = unknown>(
    method: string,
    path: string,
    options: { query?: Record<string, unknown>; body?: unknown } = {},
  ): Promise<T> {
    const url = new URL(`${this.root}${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value === undefined || value === null || value === "") continue;
      url.searchParams.set(key, String(value));
    }

    const doFetch = this.config.fetchImpl ?? fetch;
    const response = await doFetch(url, {
      method,
      headers: {
        authorization: `Bearer ${this.config.apiKey}`,
        ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

    if (response.status === 204) return undefined as T;

    const text = await response.text();
    let payload: unknown = undefined;
    try {
      payload = text ? JSON.parse(text) : undefined;
    } catch {
      // A non-JSON body from a 5xx or a proxy in the way: keep the text, it is
      // the only clue the assistant will get.
    }

    if (!response.ok) {
      const error = (payload as { error?: { code?: string; message?: string } } | undefined)?.error;
      throw new ApiError(
        response.status,
        error?.code ?? "http_error",
        error?.message ?? text.slice(0, 300) ?? `HTTP ${response.status}`,
      );
    }
    return payload as T;
  }

  get<T>(path: string, query?: Record<string, unknown>) {
    return this.request<T>("GET", path, { query });
  }
  post<T>(path: string, body: unknown) {
    return this.request<T>("POST", path, { body });
  }
  patch<T>(path: string, body: unknown) {
    return this.request<T>("PATCH", path, { body });
  }

  /**
   * Walks a paginated collection to the end.
   *
   * Capped, because an assistant asking for "all the alerts" on a noisy
   * workspace would blow past any context window and take a minute doing it.
   * The cap is reported to the caller rather than hidden, so it can say "there
   * are more" instead of quietly answering from a slice.
   */
  async collect<T>(
    path: string,
    query: Record<string, unknown> = {},
    max = 200,
  ): Promise<{ items: T[]; truncated: boolean }> {
    const items: T[] = [];
    let cursor: string | null = null;
    do {
      const page: { data: T[]; next_cursor?: string | null } = await this.get(path, {
        ...query,
        limit: Math.min(100, max - items.length),
        cursor,
      });
      items.push(...page.data);
      cursor = page.next_cursor ?? null;
    } while (cursor && items.length < max);
    return { items, truncated: Boolean(cursor) };
  }
}
