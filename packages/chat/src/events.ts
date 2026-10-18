/**
 * The chat log: what was sent to Slack or Teams and what came back, with the
 * status the provider really answered. Recorded at the moment of the call by
 * the adapters and the inbound handlers; read by Settings › Slack & Teams.
 *
 * Recording never breaks the gesture it describes: a failure to write the log
 * is reported on the console and swallowed — the message itself went out (or
 * did not) regardless.
 */
import { and, eq, lt, sql } from "drizzle-orm";
import {
  chatEvents,
  withTenant,
  type ChatEventKind,
  type ChatProvider,
  type Tx,
} from "@openincident/db";

export type ChatEventInput = {
  provider: ChatProvider;
  kind: ChatEventKind;
  direction?: "out" | "in";
  target?: string | null;
  detail?: string | null;
  ok?: boolean;
  error?: string | null;
  incidentId?: string | null;
  memberId?: string | null;
  meta?: Record<string, unknown>;
};

/** How long the log keeps a line — the Health list reads hours, the card "last event" days. */
const KEEP_DAYS = 30;

function row(tenantId: string, e: ChatEventInput) {
  const ok = e.ok ?? !e.error;
  return {
    tenantId,
    provider: e.provider,
    direction: e.direction ?? ("out" as const),
    kind: e.kind,
    target: e.target?.slice(0, 200) ?? null,
    detail: e.detail?.slice(0, 300) ?? null,
    status: ok ? ("delivered" as const) : ("failed" as const),
    error: ok ? null : (e.error ?? "failed").slice(0, 120),
    incidentId: e.incidentId ?? null,
    memberId: e.memberId ?? null,
    meta: e.meta ?? {},
  };
}

async function write(tx: Tx, tenantId: string, e: ChatEventInput): Promise<void> {
  await tx.insert(chatEvents).values(row(tenantId, e));
  // Keep the log bounded without a job: one write in fifty sweeps the old lines.
  if (Math.random() < 0.02)
    await tx
      .delete(chatEvents)
      .where(
        and(
          eq(chatEvents.tenantId, tenantId),
          lt(chatEvents.createdAt, sql`now() - make_interval(days => ${KEEP_DAYS})`),
        ),
      );
}

/**
 * Records one line. Pass the open transaction when there is one (the line
 * then commits with the work it describes); without it, a short one of its own.
 */
export async function recordChatEvent(tenantId: string, e: ChatEventInput, tx?: Tx): Promise<void> {
  try {
    if (tx) await write(tx, tenantId, e);
    else await withTenant(tenantId, (t) => write(t, tenantId, e));
  } catch (err) {
    console.error("[chat] could not record the event:", err instanceof Error ? err.message : err);
  }
}

/**
 * A page delivered as a direct message, acknowledged from the chat tool: the
 * line of the page says so, the way the design writes it ("— acknowledged
 * from chat 21:59").
 */
export async function markChatPageAcknowledged(
  tenantId: string,
  provider: ChatProvider,
  ref: string,
  by: string,
): Promise<void> {
  try {
    await withTenant(tenantId, (tx) =>
      tx
        .update(chatEvents)
        .set({
          meta: sql`${chatEvents.meta} || ${JSON.stringify({ ackAt: new Date().toISOString(), ackBy: by })}::jsonb`,
        })
        .where(
          and(
            eq(chatEvents.tenantId, tenantId),
            eq(chatEvents.provider, provider),
            eq(chatEvents.kind, "page"),
            sql`${chatEvents.meta}->>'ref' = ${ref}`,
          ),
        ),
    );
  } catch (err) {
    console.error("[chat] could not mark the page:", err instanceof Error ? err.message : err);
  }
}
