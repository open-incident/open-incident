import { redirect } from "next/navigation";

/**
 * Heartbeats moved beside the monitors — the other thing that watches by
 * waiting. Bookmarks, the alert's own link and the guide's older editions
 * still point here; they land where the screen went, query included.
 */
export default async function HeartbeatsMoved({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) if (v !== undefined) q.set(k, v);
  const query = q.toString();
  redirect(`/app/monitors/heartbeats${query ? `?${query}` : ""}`);
}
