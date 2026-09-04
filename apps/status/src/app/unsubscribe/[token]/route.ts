import { NextResponse } from "next/server";
import { unsubscribe } from "@openincident/statuspages";
import { currentSnapshot } from "@/lib/snapshot";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const cur = await currentSnapshot();
  if (!cur) return new Response("Not found", { status: 404 });
  const { token } = await params;
  const r = /^[a-f0-9]{40}$/.test(token)
    ? await unsubscribe(cur.row.tenantId, token).catch(() => ({ ok: false }))
    : { ok: false };
  return NextResponse.redirect(`${cur.origin}/?unsubscribed=${r.ok ? "1" : "0"}`, 303);
}
