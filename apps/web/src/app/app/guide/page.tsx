import Link from "next/link";
import { cookies } from "next/headers";
import { getT } from "@/i18n/server";
import { LOCALES } from "@/i18n/locales";
import { requireMember } from "@/lib/session";
import { GUIDE_SECTIONS, listChapters } from "@/lib/guide";
import { SKIP_COOKIE } from "../home-skip";
import { ShowStepsButton } from "./show-steps";

/**
 * Guide — where the rail's "Guide" lands: Getting started, as the design
 * draws it, then every chapter of the user guide.
 *
 * The four cards say the first thing in four words each; the chapters below
 * are the guide the product ships (docs/guide), read in the product at
 * /app/docs. When the reader put Home's three steps aside, this is where they
 * come back from.
 */
export default async function GuidePage() {
  await requireMember();
  const t = await getT();
  const skipped = (await cookies()).get(SKIP_COOKIE)?.value === "1";
  const chapters = listChapters();
  const languages = new Intl.ListFormat(t.locale.tag, { type: "unit", style: "short" }).format(
    LOCALES.map((l) => l.nativeName),
  );

  const cards = [
    { label: t("gd.glance"), body: t("gd.glanceBody"), href: null },
    { label: t("gd.terms"), body: t("gd.termsBody"), href: null },
    { label: t("gd.where"), body: t("gd.whereBody"), href: "/app" },
    { label: t("gd.next"), body: t("gd.nextBody"), href: "/app/services" },
  ];

  return (
    <div
      data-screen-label="Guide"
      style={{
        maxWidth: 760,
        margin: "0 auto",
        padding: "36px 28px",
        display: "flex",
        flexDirection: "column",
        gap: 18,
        animation: "ohd-rise .2s ease backwards",
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
        {t("gd.eyebrow")}
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
        {t("gd.title")}
      </h1>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: 10,
        }}
      >
        {cards.map((c) => {
          const inner = (
            <>
              <div
                style={{
                  fontSize: 10.5,
                  fontWeight: 700,
                  letterSpacing: ".08em",
                  color: "var(--ink-3)",
                  textTransform: "uppercase",
                }}
              >
                {c.label}
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.5, marginTop: 4 }}>{c.body}</div>
            </>
          );
          const box: React.CSSProperties = {
            background: "var(--panel)",
            border: "1px solid var(--line)",
            borderRadius: 12,
            padding: "12px 14px",
            color: "inherit",
            textDecoration: "none",
          };
          return c.href ? (
            <Link key={c.label} href={c.href} className="oi-card" style={box}>
              {inner}
            </Link>
          ) : (
            <div key={c.label} style={box}>
              {inner}
            </div>
          );
        })}
      </div>
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.65, color: "var(--ink-2)" }}>
        {t("gd.lead")}
      </p>
      {skipped && <ShowStepsButton />}
      <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
        {t("gd.languages", { languages })}
      </div>

      {chapters.length > 0 && (
        <section
          data-testid="guide-chapters"
          aria-label={t("docs.title")}
          style={{
            marginTop: 14,
            paddingTop: 22,
            borderTop: "1px solid var(--line)",
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: ".1em",
              textTransform: "uppercase",
              color: "var(--ink-3)",
            }}
          >
            {t("gd.chapters")}
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
              gap: "16px 24px",
            }}
          >
            {GUIDE_SECTIONS.map((section) => {
              const items = chapters.filter((c) => c.section === section);
              if (items.length === 0) return null;
              return (
                <div key={section} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <div
                    style={{
                      fontSize: 10.5,
                      fontWeight: 700,
                      letterSpacing: ".08em",
                      textTransform: "uppercase",
                      color: "var(--ink-3)",
                      marginBottom: 2,
                    }}
                  >
                    {t(`docs.section.${section}`)}
                  </div>
                  {items.map((c) => (
                    <Link
                      key={c.slug}
                      href={`/app/docs/${c.slug}`}
                      className="oi-link"
                      style={{ fontSize: 13, lineHeight: 1.4 }}
                    >
                      {c.title}
                    </Link>
                  ))}
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
