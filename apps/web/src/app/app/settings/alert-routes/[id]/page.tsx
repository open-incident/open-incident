import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { alertRoutes, withTenant } from "@openincident/db";
import { getT } from "@/i18n/server";
import { isManager, requireMember } from "@/lib/session";
import { loadEditorData } from "../editor-data";
import { RouteEditor } from "../route-editor";

/**
 * One rule on its own URL — where a bookmark, the smoke suite and the older
 * links land. The design opens the editor inline on the rules list; this page
 * renders the same card, so neither reader sees a different screen.
 */
export default async function RulePage({ params }: { params: Promise<{ id: string }> }) {
  const { tenant, member } = await requireMember();
  const t = await getT();
  const { id } = await params;
  const data = await loadEditorData(tenant.id, id === "new" ? null : id);
  if (!data) notFound();
  if (!isManager(member))
    return (
      <div className="oi-rise" style={{ maxWidth: 760 }}>
        <p style={{ fontSize: 13, color: "var(--ink-3)" }}>{t("setup.managersOnly")}</p>
      </div>
    );
  // The place in the order, for the editor's title — the same number the list shows.
  const order = data.route
    ? await withTenant(tenant.id, (tx) =>
        tx
          .select({ id: alertRoutes.id })
          .from(alertRoutes)
          .where(eq(alertRoutes.tenantId, tenant.id))
          .orderBy(alertRoutes.position, alertRoutes.createdAt),
      )
    : [];
  const index = data.route ? order.findIndex((r) => r.id === data.route!.id) + 1 : undefined;

  return (
    <div className="oi-rise" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <Link href="/app/settings/alert-routes" className="oi-link" style={{ fontSize: 12.5 }}>
          ← {t("set2.rules.title")}
        </Link>
      </div>
      <RouteEditor
        route={data.route}
        index={index}
        cancelHref="/app/settings/alert-routes"
        attributes={data.attributes.map((a) => ({
          key: a.key,
          label: a.label,
          type: a.type,
          catalogTypeKey: a.catalogTypeKey,
        }))}
        sources={data.sources}
        paths={data.paths.map((p) => ({ id: p.id, name: p.name, published: Boolean(p.current) }))}
        types={data.types}
        severities={data.sevs}
        priorities={data.prios}
        fields={data.fields}
        people={data.targets.people.filter((p) => p.id !== member.id)}
        schedules={data.targets.schedules}
        slackInstalled={data.slack}
        channels={data.channels}
      />
    </div>
  );
}
