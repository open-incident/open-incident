/**
 * POST /api/atlas/internal — the worker's way into the product's write paths
 * for Atlas (see packages/investigations/src/atlas/host.ts). Signed with the
 * instance key (header x-oi-atlas-signature, five-minute window); anything
 * unsigned is a 404, as if the route did not exist.
 *
 * Besides the host operations it answers three maintenance calls an operator
 * or the smoke suite may make on an instance without a worker. They name the
 * workspace by id or by slug, and an incident by id or by number:
 *   { op: "assess", … }  — one assessment and its Atlas step, here;
 *   { op: "sweep", … }   — verification, reopenings, summaries;
 *   { op: "inspect", … } — an incident's journal, with its one-tap links.
 */
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { atlas, ensureInvestigationRow, runInvestigation } from "@openincident/investigations";
import {
  getTenantById,
  getTenantBySlug,
  incidents,
  investigations,
  members,
  withTenant,
} from "@openincident/db";
import { runHostOp, webHost } from "@/lib/atlas/host";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Ref = {
  tenantId?: string;
  tenantSlug?: string;
  incidentId?: string;
  incidentNumber?: number;
  /** inspect: sign the links for this member, as a push to them would. */
  memberEmail?: string;
};
type Maintenance = Ref & { op: "assess" | "sweep" | "inspect" };

async function tenantOf(ref: Ref): Promise<string | null> {
  if (ref.tenantId) return (await getTenantById(ref.tenantId)) ? ref.tenantId : null;
  if (!ref.tenantSlug) return null;
  return (await getTenantBySlug(ref.tenantSlug))?.id ?? null;
}

async function incidentOf(tenantId: string, ref: Ref): Promise<string | null> {
  if (ref.incidentId) return ref.incidentId;
  if (typeof ref.incidentNumber !== "number") return null;
  const [r] = await withTenant(tenantId, (tx) =>
    tx
      .select({ id: incidents.id })
      .from(incidents)
      .where(and(eq(incidents.tenantId, tenantId), eq(incidents.number, ref.incidentNumber!))),
  );
  return r?.id ?? null;
}

export async function POST(request: Request) {
  const raw = await request.text();
  if (!atlas.verifyInternal(request.headers.get(atlas.INTERNAL_HEADER), raw))
    return new NextResponse("Not found", { status: 404 });
  let body: (atlas.HostOp | Maintenance) & Ref;
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid body" }, { status: 400 });
  }
  const tenantId = body ? await tenantOf(body) : null;
  if (!tenantId)
    return NextResponse.json({ ok: false, error: "unknown workspace" }, { status: 404 });

  if (body.op === "sweep") {
    const out = await atlas.atlasSweep([tenantId], webHost);
    return NextResponse.json({ ok: true, data: out });
  }
  if (body.op === "assess" || body.op === "inspect") {
    const incidentId = await incidentOf(tenantId, body);
    if (!incidentId)
      return NextResponse.json({ ok: false, error: "unknown incident" }, { status: 404 });
    if (body.op === "assess") {
      await ensureInvestigationRow(tenantId, incidentId, "manual");
      await runInvestigation(
        {
          tenantId,
          incidentId,
          trigger: "manual",
          origin: await atlas.tenantPublicOrigin(tenantId),
        },
        { host: webHost },
      );
    }
    const [inv] = await withTenant(tenantId, (tx) =>
      tx.select().from(investigations).where(eq(investigations.incidentId, incidentId)),
    );
    const journal = await atlas.journalOf(tenantId, incidentId);
    const origin = await atlas.tenantPublicOrigin(tenantId);
    const [who] = body.memberEmail
      ? await withTenant(tenantId, (tx) =>
          tx
            .select({ id: members.id })
            .from(members)
            .where(and(eq(members.tenantId, tenantId), eq(members.email, body.memberEmail!))),
        )
      : [];
    const link = (op: "undo" | "approve" | "stop", id: string) =>
      `${origin}/ack/atlas/${atlas.signLink({ t: tenantId, op, id, m: who?.id ?? null }, atlas.UNDO_WINDOW_MS)}`;
    return NextResponse.json({
      ok: true,
      data: {
        tenantId,
        incidentId,
        investigation: inv
          ? {
              id: inv.id,
              status: inv.status,
              reviewState: inv.reviewState,
              resolvedAlone: inv.resolvedAlone,
              levelAtStart: inv.levelAtStart,
              costEur: inv.costEur,
              tokensTotal: inv.tokensTotal,
              error: inv.error,
            }
          : null,
        stop: link("stop", incidentId),
        journal: journal.map((a) => ({
          id: a.id,
          kind: a.kind,
          title: a.title,
          actionKey: a.actionKey,
          level: a.level,
          autonomous: a.autonomous,
          approvalState: a.approvalState,
          executedAt: a.executedAt,
          verifiedAt: a.verifiedAt,
          undoneAt: a.undoneAt,
          reversible: a.reversible,
          text: (a.payload as { text?: unknown }).text ?? null,
          links:
            a.kind === "system" || a.kind === "oi_write"
              ? { undo: link("undo", a.id), approve: link("approve", a.id) }
              : null,
        })),
      },
    });
  }
  const result = await runHostOp({ ...(body as atlas.HostOp), tenantId });
  return NextResponse.json(result, { status: result.ok ? 200 : 422 });
}
