/** POST /api/slack/events — Events API: the URL challenge, then reactions and pins in incident channels. */
import { verifySlackRequest } from "@openincident/chat";
import { handleEvent, slackContextForTeam } from "@/lib/slack";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const raw = await request.text();
  let body: {
    type?: string;
    challenge?: string;
    team_id?: string;
    event?: Record<string, unknown>;
  };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    return new Response("bad payload", { status: 400 });
  }
  if (body.type === "url_verification" && body.challenge)
    return Response.json({ challenge: body.challenge });
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret || !verifySlackRequest(secret, request.headers, raw))
    return new Response("bad signature", { status: 401 });
  if (body.type !== "event_callback" || !body.team_id || !body.event)
    return new Response("", { status: 200 });
  const ctx = await slackContextForTeam(body.team_id);
  if (!ctx) return new Response("", { status: 200 });
  // Slack retries anything slower than three seconds: acknowledge now, work after.
  void handleEvent(ctx, body.event as Parameters<typeof handleEvent>[1]).catch((err) =>
    console.error("[slack] event failed", err),
  );
  return new Response("", { status: 200 });
}
