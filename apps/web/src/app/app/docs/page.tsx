import { redirect } from "next/navigation";
import { listChapters } from "@/lib/guide";
import { getT } from "@/i18n/server";

/** /app/docs → the first chapter; an honest notice when the guide files are missing. */
export default async function DocsIndex() {
  const chapters = listChapters();
  if (chapters[0]) redirect(`/app/docs/${chapters[0].slug}`);
  const t = await getT();
  return (
    <div style={{ padding: 32, color: "var(--ink-2)", fontSize: 13.5 }}>{t("docs.notFound")}</div>
  );
}
