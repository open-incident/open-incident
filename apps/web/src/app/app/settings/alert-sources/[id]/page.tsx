import { redirect } from "next/navigation";

/** One source, moved under the alerts — the old address still leads to it. */
export default async function AlertSourceSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const raw = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(raw))
    if (typeof value === "string") query.set(key, value);
  const search = query.toString();
  redirect(`/app/alerts/sources/${id}${search ? `?${search}` : ""}`);
}
