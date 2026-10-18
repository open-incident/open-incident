/**
 * The executors — how an allowed action reaches a system. Real calls only.
 *
 * Every system action (a rollback, a flag, a restart…) goes to the customer's
 * own automation as a signed HTTP request: a "do" URL, an "undo" URL — an
 * action without one is not reversible and can never be given to Atlas — and
 * an optional "verify" URL the engine polls until the system says it is
 * healthy. Kubernetes, feature flags, deploys and runbooks are all reached
 * that way: the instance ships no cluster credentials. An action whose
 * endpoints are not configured is unavailable, and says so.
 *
 * What Atlas writes inside the product (an update, a follow-up, a
 * resolution) is not here: that goes through the product's own write paths,
 * reached through the host (see host.ts).
 */
import type { actionCatalog } from "@openincident/db";
import { EXECUTOR_HEADER, executorSecret, signExecutorBody } from "./sign";

export type ActionRow = typeof actionCatalog.$inferSelect;

export type HttpConfig = {
  doUrl: string | null;
  undoUrl: string | null;
  verifyUrl: string | null;
};

export function httpConfig(action: Pick<ActionRow, "limits">): HttpConfig {
  const h = (action.limits?.http ?? {}) as Partial<HttpConfig>;
  const url = (v: unknown) => (typeof v === "string" && /^https?:\/\/\S+$/i.test(v) ? v : null);
  return { doUrl: url(h.doUrl), undoUrl: url(h.undoUrl), verifyUrl: url(h.verifyUrl) };
}

/** Reversible means: there is a way back, configured. */
export function isReversible(action: Pick<ActionRow, "limits" | "reversible">): boolean {
  return action.reversible && Boolean(httpConfig(action).undoUrl);
}

/** Can be run on this instance right now: its endpoint exists. */
export function isAvailable(action: Pick<ActionRow, "limits">): boolean {
  return Boolean(httpConfig(action).doUrl);
}

/** An optional pattern the target must match (limits.targets, a regular expression). */
export function targetAllowed(action: Pick<ActionRow, "limits">, target: string | null): boolean {
  const p = action.limits?.targets;
  if (typeof p !== "string" || !p) return true;
  if (!target) return false;
  try {
    return new RegExp(`^(?:${p})$`).test(target);
  } catch {
    return false;
  }
}

export type ExecPhase = "do" | "undo" | "verify";

export type ExecRequest = {
  tenantId: string;
  nonce: string;
  action: Pick<ActionRow, "key" | "limits">;
  phase: ExecPhase;
  /** The journal row — the idempotency key the automation should honour. */
  actionId: string;
  incident: { number: number; title: string; service: string | null; severity: string | null };
  target: string | null;
};

export type ExecResult =
  | { ok: true; ref: string | null; detail: string | null; healthy: boolean | null; status: number }
  | { ok: false; error: string; status: number | null };

const TIMEOUT_MS = 20_000;

/** One signed request to the customer's automation. Never throws. */
export async function callExecutor(req: ExecRequest): Promise<ExecResult> {
  const cfg = httpConfig(req.action);
  const url = req.phase === "do" ? cfg.doUrl : req.phase === "undo" ? cfg.undoUrl : cfg.verifyUrl;
  if (!url) return { ok: false, error: `no ${req.phase} endpoint configured`, status: null };
  const body = JSON.stringify({
    action: req.action.key,
    phase: req.phase,
    id: req.actionId,
    incident: req.incident,
    target: req.target,
    sentAt: new Date().toISOString(),
  });
  const secret = executorSecret(req.tenantId, req.nonce);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "OpenIncident-Atlas/1",
        "idempotency-key": `${req.actionId}:${req.phase}`,
        [EXECUTOR_HEADER]: signExecutorBody(secret, body),
      },
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text().catch(() => "");
    let data: Record<string, unknown> = {};
    try {
      data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      data = {};
    }
    if (res.status < 200 || res.status >= 300)
      return {
        ok: false,
        error: `${url.replace(/\?.*$/, "")} answered ${res.status}${
          typeof data.error === "string" ? `: ${data.error.slice(0, 160)}` : ""
        }`,
        status: res.status,
      };
    if (data.ok === false)
      return {
        ok: false,
        error: typeof data.error === "string" ? data.error.slice(0, 200) : "refused",
        status: res.status,
      };
    return {
      ok: true,
      ref: typeof data.ref === "string" ? data.ref.slice(0, 80) : null,
      detail: typeof data.detail === "string" ? data.detail.slice(0, 300) : null,
      healthy: typeof data.healthy === "boolean" ? data.healthy : null,
      status: res.status,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    let host = url;
    try {
      host = new URL(url).host;
    } catch {
      /* keep the raw value */
    }
    return {
      ok: false,
      error: /timeout|abort/i.test(msg)
        ? `${host} did not answer in 20 s`
        : `could not reach ${host}`,
      status: null,
    };
  }
}
