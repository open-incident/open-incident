/** POST /api/slack/commands — the `/incident` slash command (form-encoded, signed). */
import { verifySlackRequest } from "@openincident/chat";
import { handleSlashCommand, slackContextForTeam } from "@/lib/slack";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const raw = await request.text();
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret || !verifySlackRequest(secret, request.headers, raw))
    return new Response("bad signature", { status: 401 });
  const form = Object.fromEntries(new URLSearchParams(raw).entries());
  const ctx = form.team_id ? await slackContextForTeam(form.team_id) : null;
  if (!ctx)
    return Response.json({
      response_type: "ephemeral",
      text: "This Slack workspace is not connected to an Open Incident workspace.",
    });
  try {
    const reply = await handleSlashCommand(ctx, form);
    return reply ? Response.json(reply) : new Response("", { status: 200 });
  } catch (err) {
    console.error("[slack] command failed", err);
    return Response.json({
      response_type: "ephemeral",
      text: "Something went wrong on our side — the incident is unchanged.",
    });
  }
}
