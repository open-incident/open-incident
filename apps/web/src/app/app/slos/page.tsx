import { redirect } from "next/navigation";

/**
 * Objectives moved into Telemetry, and this route stays as the redirect.
 *
 * Links to `/app/slos` are in runbooks, in bookmarks and in alert bodies the
 * product has already sent. Deleting the route would turn every one of them
 * into a 404 for a page that still exists under another name, which is the
 * kind of breakage nobody reports and everybody works around.
 */
export default async function SlosPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; why?: string; new?: string }>;
}) {
  const q = await searchParams;
  const params = new URLSearchParams({ tab: "slos" });
  for (const [key, value] of Object.entries(q)) if (value) params.set(key, value);
  redirect(`/app/telemetry?${params.toString()}`);
}
