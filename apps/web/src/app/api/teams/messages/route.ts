/**
 * POST /api/teams/messages — the bot's messaging endpoint. Every activity is
 * verified against the Bot Framework's keys before anything is read; the
 * answer is 200 at once, the work happens after the response.
 */
import { after } from "next/server";
import { teamsConfigured, verifyTeamsToken } from "@openincident/chat";
import { handleTeamsActivity, type TeamsActivity } from "@/lib/teams";

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
  after(async () => {
    try {
      await handleTeamsActivity(activity);
    } catch (err) {
      console.error("[teams] activity failed:", err);
    }
  });
  return new Response(null, { status: 200 });
}
