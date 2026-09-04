import { and, asc, eq, gt } from "drizzle-orm";
import { incidentEvents, withTenant } from "@openincident/db";
import { currentMember } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Server-sent events for one incident's timeline. Reads `incident_events`
 * every two seconds inside the member's tenant context and emits one message
 * per new row — the table is the only source, nothing is kept in memory.
 * Closes when the client goes away.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const current = await currentMember();
  if (!current) return new Response("unauthorized", { status: 401 });
  const { id } = await params;
  const url = new URL(request.url);
  let afterId = url.searchParams.get("after") ?? "";
  let afterTime: Date | null = null;

  if (afterId) {
    afterTime = await withTenant(current.tenant.id, async (tx) => {
      const [row] = await tx
        .select({ createdAt: incidentEvents.createdAt })
        .from(incidentEvents)
        .where(and(eq(incidentEvents.incidentId, id), eq(incidentEvents.id, afterId)));
      return row?.createdAt ?? null;
    });
  }
  if (!afterTime) afterTime = new Date();

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      send("ready", { at: new Date().toISOString() });
      const tick = async () => {
        if (closed) return;
        try {
          const rows = await withTenant(current.tenant.id, (tx) =>
            tx
              .select({
                id: incidentEvents.id,
                kind: incidentEvents.kind,
                createdAt: incidentEvents.createdAt,
              })
              .from(incidentEvents)
              .where(
                and(eq(incidentEvents.incidentId, id), gt(incidentEvents.createdAt, afterTime!)),
              )
              .orderBy(asc(incidentEvents.createdAt)),
          );
          for (const row of rows) {
            send("incident-event", { id: row.id, kind: row.kind });
            afterTime = row.createdAt;
            afterId = row.id;
          }
          if (rows.length === 0) controller.enqueue(encoder.encode(": keep-alive\n\n"));
        } catch (err) {
          console.error("[sse] incident events:", err);
        }
      };
      const timer = setInterval(tick, 2000);
      request.signal.addEventListener("abort", () => {
        closed = true;
        clearInterval(timer);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
