/** POST /api/slack/interactions — modals submitted, buttons pressed, message shortcuts (form field `payload`, signed). */
import { verifySlackRequest } from "@openincident/chat";
import { handleInteraction, slackContextForTeam, type Interaction } from "@/lib/slack";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const raw = await request.text();
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret || !verifySlackRequest(secret, request.headers, raw))
    return new Response("bad signature", { status: 401 });
  let payload: Interaction & { team?: { id: string } };
  try {
    payload = JSON.parse(new URLSearchParams(raw).get("payload") ?? "{}") as Interaction & {
      team?: { id: string };
    };
  } catch {
    return new Response("bad payload", { status: 400 });
  }
  const ctx = payload.team?.id ? await slackContextForTeam(payload.team.id) : null;
  if (!ctx) return new Response("", { status: 200 });
  try {
    const reply = await handleInteraction(ctx, payload);
    return reply ? Response.json(reply) : new Response("", { status: 200 });
  } catch (err) {
    console.error("[slack] interaction failed", err);
    return new Response("", { status: 200 });
  }
}
