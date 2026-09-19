import { redirect } from "next/navigation";

/**
 * The sources live with the alerts now.
 *
 * Kept as a redirect because the settings rail, the alerting checklist and the
 * integrations list all point here, and a bookmark from before the move
 * should land on the screen rather than on a 404.
 */
export default async function AlertSourcesSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string; tested?: string; alert?: string }>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams();
  if (params.new) query.set("new", params.new);
  if (params.tested) query.set("tested", params.tested);
  if (params.alert) query.set("alert", params.alert);
  const search = query.toString();
  redirect(`/app/alerts/sources${search ? `?${search}` : ""}`);
}
