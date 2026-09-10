import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import {
  alertAttributes,
  alertPriorities,
  alertRoutes,
  alertSources,
  withTenant,
} from "@openincident/db";
import { payloadPaths } from "@openincident/oncall/routing";
import { getT } from "@/i18n/server";
import { isManager, requireMember } from "@/lib/session";
import { requestOrigin } from "@/lib/tenant";
import { headers } from "next/headers";
import { recentPayloads } from "@/lib/alerting-setup";
import { curlSnippet, sourceKindMeta } from "@/lib/alert-sources";
import { describeRoute } from "@/lib/route-summary";
import { IntegrationIcon } from "../../integrations/icons";
import { ConditionsEditor } from "@/components/alerting/conditions-editor";
import { MappingEditor } from "@/components/alerting/mapping-editor";
import { PriorityRuleEditor } from "@/components/alerting/priority-rule-editor";
import { PayloadTester } from "@/components/alerting/payload-tester";
import { SourceSetup } from "@/components/alerting/source-setup";
import {
  deleteSource,
  saveSourceFilter,
  saveSourceMeta,
  testSource,
  toggleSource,
} from "../actions";

const card: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: 13,
  boxShadow: "var(--shadow-card)",
  padding: "14px 18px",
  display: "flex",
  flexDirection: "column",
  gap: 10,
};
const head: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  flexWrap: "wrap",
};
const h2: React.CSSProperties = { margin: 0, fontSize: 14, fontWeight: 600 };
const muted: React.CSSProperties = {
  fontSize: 12.5,
  color: "var(--ink-3)",
  lineHeight: 1.5,
  margin: 0,
};
const btn: React.CSSProperties = {
  height: 30,
  padding: "0 11px",
  border: "1px solid var(--line)",
  borderRadius: 8,
  background: "var(--panel)",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  color: "inherit",
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
};

/**
 * One source, everything about it: how to connect the tool, the alerts it
 * sent, how its payload becomes the workspace's attributes (previewed against
 * a real alert), the priority it sets, what it filters out, a tester that
 * shows what the pipeline would do with any payload, and the routes reading it.
 */
export default async function SourcePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string; tested?: string; created?: string }>;
}) {
  const { tenant, member } = await requireMember();
  const t = await getT();
  const { id } = await params;
  const { saved, error, tested } = await searchParams;
  const manages = isManager(member);
  const data = await withTenant(tenant.id, async (tx) => {
    const [source] = await tx
      .select()
      .from(alertSources)
      .where(and(eq(alertSources.tenantId, tenant.id), eq(alertSources.id, id)));
    if (!source) return null;
    const registry = await tx
      .select()
      .from(alertAttributes)
      .where(eq(alertAttributes.tenantId, tenant.id))
      .orderBy(alertAttributes.position);
    const priorities = await tx
      .select({
        id: alertPriorities.id,
        name: alertPriorities.name,
        isDefault: alertPriorities.isDefault,
      })
      .from(alertPriorities)
      .where(eq(alertPriorities.tenantId, tenant.id))
      .orderBy(alertPriorities.rank);
    const routes = await tx
      .select()
      .from(alertRoutes)
      .where(eq(alertRoutes.tenantId, tenant.id))
      .orderBy(alertRoutes.position, alertRoutes.createdAt);
    const samples = await recentPayloads(tx, source.id);
    const sources = await tx
      .select({ id: alertSources.id, name: alertSources.name })
      .from(alertSources)
      .where(eq(alertSources.tenantId, tenant.id));
    return { source, registry, priorities, routes, samples, sources };
  });
  if (!data) notFound();
  const { source } = data;
  const meta = sourceKindMeta(source.kind);
  const h = await headers();
  const origin = requestOrigin({
    headers: h,
    nextUrl: new URL(`http://${h.get("host") ?? "localhost"}/`),
  });
  const endpoint = `${origin}/api/ingest/alerts/${source.id}`;
  const steps = t(`settings.sources.howto.${source.kind}`).split("\n").filter(Boolean);
  const samplePaths = data.samples[0]
    ? payloadPaths(data.samples[0].payload).map((p) => p.path)
    : [];
  const attrOptions = data.registry.map((a) => ({
    key: a.key,
    label: a.label,
    type: a.type,
    required: a.required,
  }));
  const readingRoutes = data.routes.filter(
    (r) => r.sourceIds.length === 0 || r.sourceIds.includes(source.id),
  );
  const missingRequired = data.registry.filter(
    (a) => a.required && !source.mappings.some((m) => m.attribute === a.key),
  );
  const tester = JSON.stringify(
    data.samples.find((s) => !s.testMode)?.payload ??
      meta.sample(source.name, new Date().toISOString()),
    null,
    2,
  );

  return (
    <div
      className="oi-rise"
      style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 980 }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <Link href="/app/settings/alert-sources" className="oi-link" style={{ fontSize: 12.5 }}>
          ← {t("settings.nav.alertSources")}
        </Link>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <IntegrationIcon id={meta.icon} />
          <h1 className="oi-title" style={{ margin: 0 }} data-testid="source-title">
            {source.name}
          </h1>
        </span>
        <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{meta.label}</span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            padding: "1px 8px",
            borderRadius: 999,
            background: source.active ? "var(--ok-t)" : "var(--sunk)",
            color: source.active ? "var(--ok)" : "var(--ink-3)",
          }}
        >
          {source.active ? t("settings.sources.active") : t("settings.sources.inactive")}
        </span>
        <span style={{ flex: 1 }} />
        {saved && (
          <span role="status" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ok)" }}>
            {t("common.saved")}
          </span>
        )}
        {error && (
          <span role="alert" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--dang)" }}>
            {t("settings.fields.errorInvalid")}
          </span>
        )}
        {tested && (
          <Link
            href={`/app/alerts/${tested}`}
            className="oi-link"
            style={{ fontSize: 12.5, fontWeight: 600 }}
          >
            {t("settings.sources.testedOpen")}
          </Link>
        )}
        {manages && (
          <>
            <form action={testSource}>
              <input type="hidden" name="id" value={source.id} />
              <input type="hidden" name="back" value="detail" />
              <button type="submit" style={btn} data-testid="source-test">
                {t("settings.sources.test")}
              </button>
            </form>
            <form action={toggleSource}>
              <input type="hidden" name="id" value={source.id} />
              <button type="submit" style={btn}>
                {source.active ? t("settings.sources.disable") : t("settings.sources.enable")}
              </button>
            </form>
          </>
        )}
      </div>

      {manages && (
        <form
          action={saveSourceMeta}
          style={{ ...card, flexDirection: "row", alignItems: "center", flexWrap: "wrap" }}
        >
          <input type="hidden" name="id" value={source.id} />
          <input
            name="name"
            defaultValue={source.name}
            required
            minLength={2}
            maxLength={80}
            className="oi-field"
            style={{
              height: 32,
              padding: "0 10px",
              border: "1px solid var(--line)",
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              background: "var(--panel)",
              width: 240,
            }}
          />
          <input
            name="description"
            defaultValue={source.description ?? ""}
            maxLength={300}
            placeholder={t("settings.sources.descriptionPlaceholder")}
            className="oi-field"
            style={{
              height: 32,
              padding: "0 10px",
              border: "1px solid var(--line)",
              borderRadius: 8,
              fontSize: 13,
              background: "var(--panel)",
              flex: 1,
              minWidth: 240,
            }}
          />
          <button type="submit" style={btn}>
            {t("common.save")}
          </button>
        </form>
      )}

      <section style={card} id="setup">
        <div style={head}>
          <h2 style={h2}>{t("settings.sources.setup")}</h2>
          <p style={muted}>{t("settings.sources.setupNote")}</p>
        </div>
        <SourceSetup
          kindLabel={meta.label}
          sourceId={source.id}
          endpoint={endpoint}
          secret={null}
          steps={steps}
          curl={curlSnippet(endpoint, source.kind)}
          hasAlerts={Boolean(source.lastAlertAt)}
        />
      </section>

      <section style={card} id="attributes" data-testid="source-attributes">
        <div style={head}>
          <h2 style={h2}>{t("settings.sources.attributes")}</h2>
          <p style={muted}>{t("settings.sources.attributesNote")}</p>
          <span style={{ flex: 1 }} />
          <Link
            href="/app/settings/alert-attributes"
            className="oi-link"
            style={{ fontSize: 12.5 }}
          >
            {t("settings.nav.alertAttributes")} →
          </Link>
        </div>
        {missingRequired.length > 0 && (
          <p
            style={{ ...muted, color: "var(--wait)", fontWeight: 600 }}
            data-testid="source-missing-required"
          >
            {t("settings.sources.missingRequired", {
              keys: missingRequired.map((a) => a.label).join(", "),
            })}
          </p>
        )}
        {manages ? (
          <MappingEditor
            sourceId={source.id}
            initial={source.mappings}
            attributes={attrOptions}
            samples={data.samples.map((s) => ({
              id: s.id,
              title: s.title,
              payload: s.payload,
              testMode: s.testMode,
            }))}
          />
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
            {source.mappings.map((m, i) => (
              <li key={i}>
                <code>{m.attribute}</code> ← <code>{m.path || m.value}</code>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, alignItems: "start" }}
      >
        <section style={card} id="priority">
          <div style={head}>
            <h2 style={h2}>{t("settings.sources.priority.title")}</h2>
          </div>
          <p style={muted}>{t("settings.sources.priority.note")}</p>
          {manages ? (
            <PriorityRuleEditor
              sourceId={source.id}
              initial={source.priorityRule}
              priorities={data.priorities}
              paths={samplePaths}
            />
          ) : (
            <p style={muted}>
              {source.priorityRule ? source.priorityRule.mode : t("settings.sources.priority.none")}
            </p>
          )}
        </section>
        <section style={card} id="filter">
          <div style={head}>
            <h2 style={h2}>{t("settings.sources.filter.title")}</h2>
          </div>
          <p style={muted}>{t("settings.sources.filter.note")}</p>
          {manages ? (
            <form
              action={saveSourceFilter}
              style={{ display: "flex", flexDirection: "column", gap: 10 }}
            >
              <input type="hidden" name="id" value={source.id} />
              <ConditionsEditor
                name="conditions"
                initial={source.filter}
                attributes={attrOptions.map((a) => ({ key: a.key, label: a.label }))}
                emptyLabel={t("settings.sources.filter.empty")}
              />
              <div>
                <button type="submit" style={btn}>
                  {t("common.save")}
                </button>
              </div>
            </form>
          ) : null}
        </section>
      </div>

      <section style={card} id="preview" data-testid="source-preview">
        <div style={head}>
          <h2 style={h2}>{t("settings.sources.tester.title")}</h2>
          <p style={muted}>{t("settings.sources.tester.note")}</p>
        </div>
        {manages ? (
          <PayloadTester sourceId={source.id} initialText={tester} />
        ) : (
          <p style={muted}>{t("setup.managersOnly")}</p>
        )}
      </section>

      <section style={card}>
        <div style={head}>
          <h2 style={h2}>{t("settings.sources.routes")}</h2>
          <p style={muted}>{t("settings.sources.routesNote")}</p>
          <span style={{ flex: 1 }} />
          <Link href="/app/settings/alert-routes" className="oi-link" style={{ fontSize: 12.5 }}>
            {t("settings.nav.routes")} →
          </Link>
        </div>
        {readingRoutes.map((r, i) => {
          const d = describeRoute(r, t, { paths: [], sources: data.sources });
          return (
            <Link
              key={r.id}
              href={`/app/settings/alert-routes/${r.id}`}
              className="oi-hover"
              style={{
                display: "flex",
                gap: 10,
                padding: "6px 8px",
                margin: "0 -8px",
                borderRadius: 8,
                textDecoration: "none",
                color: "inherit",
                fontSize: 13,
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  color: "var(--ink-3)",
                  width: 16,
                }}
              >
                {i + 1}
              </span>
              <span style={{ fontWeight: 600 }}>{r.name}</span>
              <span
                style={{
                  color: "var(--ink-3)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {d.when}
              </span>
            </Link>
          );
        })}
      </section>

      {manages && (
        <form action={deleteSource} style={{ display: "flex", justifyContent: "flex-end" }}>
          <input type="hidden" name="id" value={source.id} />
          <button type="submit" className="oi-hover-dang" style={{ ...btn, color: "var(--dang)" }}>
            {t("settings.sources.delete")}
          </button>
        </form>
      )}
    </div>
  );
}
