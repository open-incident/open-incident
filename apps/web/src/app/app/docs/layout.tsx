import Link from "next/link";
import { headers } from "next/headers";
import { getT } from "@/i18n/server";
import { requireMember } from "@/lib/session";
import { GUIDE_SECTIONS, listChapters, type GuideSection } from "@/lib/guide";

/**
 * The guide's frame: chapters grouped by section on the left, the chapter in
 * the middle. Every member reads it — a viewer as much as an owner.
 */
export default async function DocsLayout({ children }: { children: React.ReactNode }) {
  await requireMember();
  const t = await getT();
  const pathname = (await headers()).get("x-pathname") ?? "";
  const chapters = listChapters();
  const sectionLabel = (s: GuideSection) => t(`docs.section.${s}`);
  return (
    <>
      <aside
        aria-label={t("docs.title")}
        style={{
          width: 252,
          flex: "none",
          background: "var(--panel)",
          borderRight: "1px solid var(--line)",
          padding: "16px 10px 24px",
          display: "flex",
          flexDirection: "column",
          gap: 2,
          overflow: "auto",
        }}
      >
        <div style={{ padding: "0 10px 10px" }}>
          <div className="oi-eyebrow">{t("docs.title")}</div>
          <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.5, marginTop: 4 }}>
            {t("docs.subtitle")}
          </div>
        </div>
        {GUIDE_SECTIONS.map((section) => {
          const items = chapters.filter((c) => c.section === section);
          if (items.length === 0) return null;
          return (
            <div
              key={section}
              style={{ display: "flex", flexDirection: "column", gap: 1, marginBottom: 10 }}
            >
              <div
                style={{
                  padding: "6px 10px 4px",
                  fontSize: 10.5,
                  fontWeight: 700,
                  letterSpacing: ".1em",
                  textTransform: "uppercase",
                  color: "var(--ink-3)",
                }}
              >
                {sectionLabel(section)}
              </div>
              {items.map((c) => {
                const href = `/app/docs/${c.slug}`;
                const active = pathname === href || pathname.startsWith(`${href}/`);
                return (
                  <Link
                    key={c.slug}
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={active ? undefined : "oi-hover"}
                    style={{
                      display: "block",
                      padding: "6px 10px",
                      borderRadius: 8,
                      background: active ? "var(--brand-t)" : "transparent",
                      color: active ? "var(--brand)" : "var(--ink-2)",
                      fontWeight: active ? 600 : 450,
                      fontSize: 13,
                      textDecoration: "none",
                      lineHeight: 1.35,
                    }}
                  >
                    {c.title}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </aside>
      <section style={{ flex: 1, minWidth: 0, overflow: "auto" }}>{children}</section>
    </>
  );
}
