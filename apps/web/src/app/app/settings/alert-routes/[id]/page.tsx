import { redirect } from "next/navigation";

/** A rule's own address moved under /app/settings/rules (design V2). */
export default async function MovedRule({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/app/settings/rules/${encodeURIComponent(id)}`);
}
