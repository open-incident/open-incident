import Link from "next/link";
import { getT } from "@/i18n/server";
import { requireMember } from "@/lib/session";

/**
 * Guide — where the three setup steps go once the workspace is past them.
 *
 * The four cards are the template every guide page follows: what it is at a
 * glance, the words it uses, where the thing lives in the product, and what to
 * read next. A page that cannot fill the four is a page that is not ready.
 */
export default async function GuidePage() {
  await requireMember();
  const t = await getT();

  const cards = [
    { k: "guide.atAGlance", v: "guide.startAtAGlance" },
    { k: "guide.terms", v: "guide.startTerms" },
    { k: "guide.whereItLives", v: "guide.startWhere" },
    { k: "guide.next", v: "guide.startNext" },
  ] as const;

  return (
    <div
      style={{
        maxWidth: 760,
        margin: "0 auto",
        padding: "36px 28px",
        display: "flex",
        flexDirection: "column",
        gap: 18,
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: ".1em",
          textTransform: "uppercase",
          color: "var(--brand-2)",
        }}
      >
        {t("guide.eyebrow")}
      </div>
      <h1
        style={{
          margin: 0,
          fontFamily: "var(--title)",
          fontSize: 28,
          fontWeight: 600,
          letterSpacing: "-.015em",
        }}
      >
        {t("guide.startTitle")}
      </h1>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
        {cards.map((c) => (
          <div
            key={c.k}
            style={{
              background: "var(--panel)",
              border: "1px solid var(--line)",
              borderRadius: 12,
              padding: "12px 14px",
            }}
          >
            <div
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                letterSpacing: ".08em",
                color: "var(--ink-3)",
              }}
            >
              {t(c.k)}
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.5, marginTop: 4 }}>{t(c.v)}</div>
          </div>
        ))}
      </div>
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.65, color: "var(--ink-2)" }}>
        {t("guide.startBody")}
      </p>
      <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{t("guide.languages")}</div>
      <Link
        href="/app/docs"
        style={{ fontSize: 13, fontWeight: 600, color: "var(--brand)", textDecoration: "none" }}
      >
        {t("guide.allChapters")} →
      </Link>
    </div>
  );
}
