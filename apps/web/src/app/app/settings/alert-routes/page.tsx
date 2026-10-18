import { redirect } from "next/navigation";

/** The screen moved to /app/settings/rules (design V2); the old address still lands there. */
export default async function Moved({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams))
    for (const one of Array.isArray(v) ? v : v === undefined ? [] : [v]) params.append(k, one);
  const qs = params.toString();
  redirect(qs ? `/app/settings/rules?${qs}` : "/app/settings/rules");
}
