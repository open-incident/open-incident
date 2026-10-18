import Link from "next/link";
import { getT } from "@/i18n/server";
import { requireMember } from "@/lib/session";
import { entitlementsFor } from "@/lib/entitlements";
import {
  FilterLinks,
  ListCard,
  ListItem,
  SettingsPage,
  listActionStyle,
} from "@/components/settings/template";
import { EmptyRow } from "../api/empty-row";
import { auditCounts, auditLines, parseArea } from "./data";
import { ExportButton } from "./export-button";
import { actorGlyph, areaLabel, present, whenLabel } from "./present";
import { AREAS, CORE_AREAS } from "./sentence";

const PAGE_SIZE = 50;

/**
 * Settings › Audit log (design V2): who did what, when — each line a
 * sentence a person reads, the actor's square (Atlas in violet), the area as
 * a chip, the time. Filtered by area (?area=atlas), fifty lines a page, and
 * exported as CSV with the filter applied.
 *
 * Lines are append-only: nothing on this screen, or anywhere in the product,
 * edits or deletes one.
 */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ area?: string; page?: string }>;
}) {
  const { tenant } = await requireMember();
  const t = await getT();
  const q = await searchParams;
  const area = parseArea(q.area);
  const page = Math.max(1, Math.floor(Number(q.page ?? "1")) || 1);
  const counts = await auditCounts(tenant.id);
  const shown = area ? counts.byArea[area] : counts.total;
  const rows = await auditLines(
    tenant.id,
    area ? counts.keysOf[area] : null,
    (page - 1) * PAGE_SIZE,
    PAGE_SIZE,
  );
  const pages = Math.max(1, Math.ceil(shown / PAGE_SIZE));
  const entitled = entitlementsFor(tenant).auditLogAdvanced;
  const href = (p: { area?: string | null; page?: number }) => {
    const s = new URLSearchParams();
    if (p.area) s.set("area", p.area);
    if (p.page && p.page > 1) s.set("page", String(p.page));
    const qs = s.toString();
    return `/app/settings/audit${qs ? `?${qs}` : ""}`;
  };
  const visibleAreas = AREAS.filter(
    (a) => CORE_AREAS.includes(a) || counts.byArea[a] > 0 || a === area,
  );

  return (
    <SettingsPage
      home={t("settingsV2.home")}
      crumb={t("settingsV2.group.platform")}
      title={t("settingsV2.entry.audit")}
      lead={t("settingsV2.audit.lead")}
      testId="settings-audit"
      actions={
        <ExportButton
          href={`/app/settings/audit/export${area ? `?area=${area}` : ""}`}
          entitled={entitled}
        />
      }
    >
      <FilterLinks
        testId="audit-filters"
        items={[
          {
            key: "all",
            label: t("settingsV2.audit.area.all"),
            count: counts.total,
            href: href({}),
            active: !area,
          },
          ...visibleAreas.map((a) => ({
            key: a,
            label: areaLabel(t, a),
            count: counts.byArea[a],
            href: href({ area: a }),
            active: area === a,
          })),
        ]}
      />
      <ListCard
        title={t("settingsV2.audit.events", { count: shown })}
        testId="audit-list"
        action={
          pages > 1 ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
                {t("settingsV2.audit.pageOf", { page, pages })}
              </span>
              {page > 1 && (
                <Link
                  href={href({ area, page: page - 1 })}
                  className="oi-hover"
                  style={listActionStyle}
                >
                  {t("settingsV2.audit.newer")}
                </Link>
              )}
              {page < pages && (
                <Link
                  href={href({ area, page: page + 1 })}
                  data-testid="audit-older"
                  className="oi-hover"
                  style={listActionStyle}
                >
                  {t("settingsV2.audit.older")}
                </Link>
              )}
            </div>
          ) : undefined
        }
        foot={t("settingsV2.audit.foot")}
      >
        {rows.map((r) => {
          const p = present(t, r);
          return (
            <ListItem
              key={r.id}
              testId="audit-row"
              data={{ area: p.area, action: r.action }}
              glyph={actorGlyph(r)}
              title={p.sentence}
              titleWeight={500}
              chips={[{ label: areaLabel(t, p.area), tone: "mute" }]}
              right={
                <time dateTime={r.createdAt.toISOString()} title={t.fmt.dateLong(r.createdAt)}>
                  {whenLabel(t, r.createdAt)}
                </time>
              }
            />
          );
        })}
        {rows.length === 0 && <EmptyRow>{t("settingsV2.audit.empty")}</EmptyRow>}
      </ListCard>
    </SettingsPage>
  );
}
