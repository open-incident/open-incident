import { rumReplay } from "@openincident/telemetry";
import { currentMember } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * One session's recording, fetched by the player when somebody presses play.
 *
 * A route rather than a prop on the page, for one reason: a recording is
 * megabytes. Serialising it into the page would make every visit to the
 * sessions list pay for a replay nobody asked to watch, and the list is the
 * screen people actually browse.
 *
 * Read inside the member's own tenant context, so the parameterised view does
 * the isolating — a session id from another workspace returns an empty
 * recording rather than somebody else's.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ session: string }> }) {
  const current = await currentMember();
  if (!current) return new Response("unauthorized", { status: 401 });

  const { session } = await params;
  if (!session || session.length > 64) return new Response("bad session", { status: 400 });

  const replay = await rumReplay(current.tenant.id, session);
  if (replay.events.length === 0) return new Response("not found", { status: 404 });

  return Response.json(replay, {
    // Private and short: a recording does not change, but it expires with the
    // workspace's retention and a shared cache has no business holding one.
    headers: { "cache-control": "private, max-age=60" },
  });
}
