/**
 * POST /api/teams/messages — the bot's messaging endpoint. Every activity is
 * verified against the Bot Framework's keys before anything is read; the
 * answer is 200 at once, the work happens after the response.
 */
import { after } from "next/server";
import { teamsConfigured, verifyTeamsToken } from "@openincident/chat";
import { handleTeamsActivity, handleTeamsInvoke, type TeamsActivity } from "@/lib/teams";
import "@/lib/chat-on-call";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!teamsConfigured())
    return new Response("Teams is not configured on this instance", { status: 404 });
  let activity: TeamsActivity;
  try {
    activity = (await request.json()) as TeamsActivity;
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  const verified = await verifyTeamsToken(
    request.headers.get("authorization"),
    activity.serviceUrl ?? null,
  );
  if (!verified) return new Response("Unauthorized", { status: 401 });
  // An invoke (the message action "Add to the timeline") is answered in the
  // response itself; everything else is acknowledged at once and worked after.
  if (activity.type === "invoke") {
    try {
      return Response.json(await handleTeamsInvoke(activity));
    } catch (err) {
      console.error("[teams] invoke failed:", err);
      return Response.json({});
    }
  }
  after(async () => {
    try {
      await handleTeamsActivity(activity);
    } catch (err) {
      console.error("[teams] activity failed:", err);
    }
  });
  return new Response(null, { status: 200 });
}
