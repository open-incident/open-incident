import { redirect } from "next/navigation";

/**
 * Dashboards moved into Telemetry, and this route stays as the redirect.
 *
 * The same reason as `/app/slos`: the address is in bookmarks and in links
 * people have sent each other, and a section that moved is not a section that
 * went away. The query follows, because the import action redirects back
 * through here to report what it could not translate.
 */
export default async function DashboardsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const q = await searchParams;
  const params = new URLSearchParams({ tab: "dashboards" });
  if (q.error) params.set("error", q.error);
  redirect(`/app/telemetry?${params.toString()}`);
}
