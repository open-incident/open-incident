import Link from "next/link";
import { notFound } from "next/navigation";
import { getT } from "@/i18n/server";
import { neighbours, readChapter } from "@/lib/guide";

/** One chapter of the guide, with its "on this page" rail and prev/next. */
export default async function DocsChapter({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const chapter = readChapter(slug);
  if (!chapter) notFound();
  const t = await getT();
  const { prev, next } = neighbours(slug);
  const sectionKey = chapter.section as
    | "getting-started"
    | "daily-use"
    | "configuration"
    | "integrations"
    | "enterprise"
    | "operations"
    | "use-cases"
    | "reference";
  return (
    <div style={{ display: "flex", gap: 32, padding: "26px 36px 48px", maxWidth: 1240 }}>
      <article className="oi-prose" style={{ flex: 1, minWidth: 0 }}>
        <div className="oi-eyebrow" style={{ marginBottom: 6 }}>
          {t(`docs.section.${sectionKey}`)}
        </div>
        <h1>{chapter.title}</h1>
        {chapter.summary && <p className="oi-prose-lead">{chapter.summary}</p>}
        <div dangerouslySetInnerHTML={{ __html: chapter.html }} />
        <nav
          aria-label={t("docs.pager")}
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            marginTop: 40,
            paddingTop: 18,
            borderTop: "1px solid var(--line)",
          }}
        >
          {prev ? (
            <Link href={`/app/docs/${prev.slug}`} className="oi-link" style={{ fontSize: 13.5 }}>
              ← {t("docs.previous")}: {prev.title}
            </Link>
          ) : (
            <span />
          )}
          {next && (
            <Link
              href={`/app/docs/${next.slug}`}
              className="oi-link"
              style={{ fontSize: 13.5, textAlign: "right" }}
            >
              {t("docs.next")}: {next.title} →
            </Link>
          )}
        </nav>
      </article>
      {chapter.headings.length > 2 && (
        <aside
          aria-label={t("docs.onThisPage")}
          style={{ width: 220, flex: "none", position: "sticky", top: 26, alignSelf: "flex-start" }}
        >
          <div className="oi-eyebrow" style={{ marginBottom: 8 }}>
            {t("docs.onThisPage")}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {chapter.headings.map((h) => (
              <a
                key={h.id}
                href={`#${h.id}`}
                className="oi-link"
                style={{
                  fontSize: 12.5,
                  color: "var(--ink-2)",
                  paddingLeft: h.level === 3 ? 12 : 0,
                  lineHeight: 1.4,
                }}
              >
                {h.text}
              </a>
            ))}
          </div>
        </aside>
      )}
    </div>
  );
}
