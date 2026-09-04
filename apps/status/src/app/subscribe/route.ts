import { NextResponse } from "next/server";
import { subscribeToPage } from "@openincident/statuspages";
import { currentSnapshot } from "@/lib/snapshot";

export const dynamic = "force-dynamic";

/** POST /subscribe — writes through the product database; when it is down, the page says so and stays up. */
export async function POST(request: Request) {
  const cur = await currentSnapshot();
  if (!cur) return new Response("Not found", { status: 404 });
  const form = await request.formData().catch(() => null);
  const email = String(form?.get("email") ?? "");
  try {
    const r = await subscribeToPage(cur.row.tenantId, cur.row.pageId, email, cur.origin);
    if (!r.ok) return NextResponse.redirect(`${cur.origin}/?error=invalid`, 303);
    return NextResponse.redirect(
      `${cur.origin}/?subscribed=${r.alreadyConfirmed ? "already" : "1"}`,
      303,
    );
  } catch {
    return NextResponse.redirect(`${cur.origin}/?error=down`, 303);
  }
}
