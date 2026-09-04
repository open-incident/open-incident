import { rssFeed } from "@openincident/statuspages";
import { currentSnapshot } from "@/lib/snapshot";
import { countFeedHit } from "@/lib/hits";

export const dynamic = "force-dynamic";

export async function GET() {
  const cur = await currentSnapshot();
  if (!cur) return new Response("Not found", { status: 404 });
  void countFeedHit(cur.row.tenantId, cur.row.pageId);
  return new Response(rssFeed(cur.snap, cur.origin), {
    headers: {
      "content-type": "application/rss+xml; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}
