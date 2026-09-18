import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import {
  alertAttributes,
  alertPriorities,
  alertSources,
  alerts,
  services,
  withTenant,
} from "@openincident/db";
import { payloadPaths } from "@openincident/oncall/routing";
import { getT } from "@/i18n/server";
import { isManager, requireMember } from "@/lib/session";
import { requestOrigin } from "@/lib/tenant";
import { recentPayloads } from "@/lib/alerting-setup";
import { sourceKindMeta } from "@/lib/alert-sources";
import { ConditionsEditor } from "@/components/alerting/conditions-editor";
import { MappingEditor } from "@/components/alerting/mapping-editor";
import { PriorityRuleEditor } from "@/components/alerting/priority-rule-editor";
import { PayloadTester } from "@/components/alerting/payload-tester";
import { IntegrationIcon } from "../../../settings/integrations/icons";
import {
  deleteSource,
  saveSourceFilter,
  testSource,
  toggleSource,
} from "../../../settings/alert-sources/actions";
import { priorityChip } from "../../tone";
import { Fold } from "../../fold";
import { sourceChoices, urgentFrom, pageableSchedules, pageableTeams } from "../choices";
import { ChoiceRows } from "../choice-rows";
import { FirstAlert, RotateSecret } from "../waiting";

const DAY = 86_400_000;
const card: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius-card)",
  boxShadow: "var(--shadow-card)",
};
const eyebrow: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: ".08em",
  color: "var(--ink-3)",
};
const btn: React.CSSProperties = {
  height: 32,
  padding: "0 13px",
  border: "1px solid var(--line)",
  borderRadius: 9,
  background: "var(--panel)",
  display: "flex",
  alignItems: "center",
  fontSize: 12.5,
  fontWeight: 600,
  cursor: "pointer",
  color: "inherit",
  textDecoration: "none",
};
const advRow: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "130px minmax(0,1fr)",
  gap: 10,
  fontSize: 12.5,
  alignItems: "center",
};
const code: React.CSSProperties = {
  fontFamily: "var(--mono)",
  fontSize: 11.5,
  background: "var(--sunk)",
  borderRadius: 7,
  padding: "6px 10px",
};

/** The bookkeeping attributes the pipeline adds itself — not labels a tool sent. */
const INTERNAL = new Set(["source", "source_name", "priority"]);

/**
 * One source: what happens when it sends an alert, what it has been sending,
 * and — folded away — how its payload is read.
 *
 * The three choices at the top are the whole screen's point. Everything under
 * "Advanced" is the machinery a workspace only opens when a label lands in the
 * wrong place.
 */
export default async function AlertSourcePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string; tested?: string }>;
}) {
  const { id } = await params;
  const { tenant, member } = await requireMember();
  const t = await getT();
  const { saved, error, tested } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const manages = isManager(member);
  const since = new Date(Date.now() - 90 * DAY);

  const data = await withTenant(tenant.id, async (tx) => {
    const [source] = await tx
      .select()
      .from(alertSources)
      .where(and(eq(alertSources.tenantId, tenant.id), eq(alertSources.id, id)));
    if (!source) return null;
    const [totals] = await tx
      .select({
        received: sql<number>`count(*)::int`.mapWith(Number),
        grouped: sql<number>`count(*) filter (where ${alerts.groupId} is not null)::int`.mapWith(
          Number,
        ),
        incidents: sql<number>`count(distinct ${alerts.incidentId})::int`.mapWith(Number),
      })
      .from(alerts)
      .where(and(eq(alerts.sourceId, source.id), gte(alerts.firstAt, since)));
    const recent = await tx
      .select({
        id: alerts.id,
        title: alerts.title,
        firstAt: alerts.firstAt,
        testMode: alerts.testMode,
        dedupKey: alerts.dedupKey,
        attributes: alerts.attributes,
        rank: alertPriorities.rank,
      })
      .from(alerts)
      .leftJoin(alertPriorities, eq(alertPriorities.id, alerts.priorityId))
      .where(eq(alerts.sourceId, source.id))
      .orderBy(desc(alerts.firstAt))
      .limit(6);
    const seen = await tx
      .select({ attributes: alerts.attributes })
      .from(alerts)
      .where(and(eq(alerts.sourceId, source.id), gte(alerts.firstAt, since)))
      .orderBy(desc(alerts.firstAt))
      .limit(300);
    const names = [
      ...new Set(
        seen.map((s) => s.attributes.service?.toLowerCase()).filter((x): x is string => Boolean(x)),
      ),
    ];
    const unowned = names.length
      ? await tx
          .select({ id: services.id, key: services.key, owner: services.ownerTeamId })
          .from(services)
          .where(and(eq(services.tenantId, tenant.id), inArray(services.key, names)))
      : [];
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
    return {
      source,
      totals: totals ?? { received: 0, grouped: 0, incidents: 0 },
      recent,
      seen,
      unowned: unowned.filter((s) => !s.owner),
      registry,
      priorities,
      samples: await recentPayloads(tx, source.id),
      choices: await sourceChoices(tx, tenant.id, source.id),
      urgent: await urgentFrom(tx, tenant.id),
      teams: await pageableTeams(tx, tenant.id),
      schedules: await pageableSchedules(tx, tenant.id),
    };
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

  // The labels the tool really sent, and how many different values each took.
  const labelValues = new Map<string, Set<string>>();
  for (const row of data.seen)
    for (const [k, v] of Object.entries(row.attributes)) {
      if (INTERNAL.has(k) || k.endsWith("_id") || !v) continue;
      const set = labelValues.get(k) ?? new Set<string>();
      set.add(v);
      labelValues.set(k, set);
    }

  const quietDays = source.lastAlertAt
    ? Math.floor((Date.now() - source.lastAlertAt.getTime()) / DAY)
    : null;
  const status = !source.active
    ? { label: t("alt2.sources.st.paused"), ink: "var(--ink-3)" }
    : data.choices.route?.testMode
      ? { label: t("alt2.sources.st.test"), ink: "var(--viol)" }
      : quietDays === null
        ? { label: t("alt2.source.waitingFirst"), ink: "var(--wait)" }
        : quietDays >= 7
          ? { label: t("alt2.sources.st.quiet", { count: quietDays }), ink: "var(--wait)" }
          : {
              label: t("alt2.source.receiving", { when: t.fmt.relative(source.lastAlertAt!) }),
              ink: "var(--ok)",
            };

  const serviceMapping = source.mappings.find((m) => m.attribute === "service");
  const priorityRule = source.priorityRule;
  const attrOptions = data.registry.map((a) => ({
    key: a.key,
    label: a.label,
    type: a.type,
    required: a.required,
  }));
  const samplePaths = data.samples[0]
    ? payloadPaths(data.samples[0].payload).map((p) => p.path)
    : [];
  const tester = JSON.stringify(
    data.samples.find((s) => !s.testMode)?.payload ??
      meta.sample(source.name, new Date().toISOString()),
    null,
    2,
  );
  const windowMinutes = data.choices.route?.grouping?.windowMinutes ?? 5;

  return (
    <div
      className="oi-rise"
      style={{
        maxWidth: 1160,
        margin: "0 auto",
        padding: "22px 28px 60px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <Link
        href="/app/alerts/sources"
        className="oi-link"
        style={{ fontSize: 12.5, color: "var(--ink-3)", width: "fit-content" }}
      >
        {t("alt2.source.back")}
      </Link>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            background: "var(--sunk)",
            display: "grid",
            placeItems: "center",
            flex: "none",
          }}
        >
          <IntegrationIcon id={meta.icon} />
        </span>
        <h1
          data-testid="source-title"
          style={{
            margin: 0,
            fontFamily: "var(--title)",
            fontSize: 22,
            fontWeight: 600,
            letterSpacing: "-.015em",
          }}
        >
          {source.name}
        </h1>
        <FirstAlert waiting={!source.lastAlertAt} label={status.label} ink={status.ink} />
        <span style={{ flex: 1 }} />
        {saved && (
          <span role="status" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ok)" }}>
            {t("common.saved")}
          </span>
        )}
        {error && (
          <span role="alert" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--dang)" }}>
            {t("alt2.connect.errorInvalid")}
          </span>
        )}
        {tested && (
          <Link href={`/app/alerts/${tested}`} className="oi-link" style={{ fontSize: 12.5 }}>
            {t("alt2.sources.openTestAlert")}
          </Link>
        )}
        {manages && (
          <>
            <form action={testSource}>
              <input type="hidden" name="id" value={source.id} />
              <input type="hidden" name="back" value="detail" />
              <button type="submit" className="oi-hover" style={btn} data-testid="source-test">
                {t("alt2.source.sendTest")}
              </button>
            </form>
            <form action={toggleSource}>
              <input type="hidden" name="id" value={source.id} />
              <button type="submit" className="oi-hover" style={{ ...btn, fontWeight: 500 }}>
                {source.active ? t("alt2.source.pause") : t("alt2.source.resume")}
              </button>
            </form>
            <RotateSecret id={source.id} name={source.name} />
          </>
        )}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0,1fr) 340px",
          gap: 14,
          alignItems: "start",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div
            style={{
              ...card,
              padding: "16px 18px",
              display: "flex",
              flexDirection: "column",
              gap: 14,
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 600 }}>
              {t("alt2.source.whatHappens", { name: source.name })}
            </div>
            <ChoiceRows
              sourceId={source.id}
              page={data.choices.page}
              incident={data.choices.incident}
              autoResolve={data.choices.autoResolve}
              teams={data.teams.map((x) => ({ id: x.id, name: x.name }))}
              schedules={data.schedules}
              urgentFrom={data.urgent}
              readerId={member.id}
              canEdit={manages}
            />
            <div
              style={{
                fontSize: 12.5,
                color: "var(--ink-2)",
                background: "var(--sunk)",
                borderRadius: 10,
                padding: "10px 13px",
                lineHeight: 1.5,
              }}
            >
              {t("alt2.source.ownerNote")}
            </div>
          </div>

          <Fold
            title={t("alt2.source.advanced")}
            hint={t("alt2.source.advancedHint")}
            showLabel={t("alt2.common.show")}
            hideLabel={t("alt2.common.hide")}
            padding="12px 18px"
          >
            <div
              style={{
                borderTop: "1px solid var(--line)",
                padding: "14px 18px",
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <div style={advRow}>
                <span style={{ color: "var(--ink-2)" }}>{t("alt2.source.adv.service")}</span>
                <code style={code}>
                  {serviceMapping
                    ? `$.${serviceMapping.path || serviceMapping.value} → service`
                    : t("alt2.source.adv.unmapped")}
                </code>
              </div>
              <div style={advRow}>
                <span style={{ color: "var(--ink-2)" }}>{t("alt2.source.adv.severity")}</span>
                <code style={code}>
                  {priorityRule?.mode === "field"
                    ? `$.${priorityRule.path}`
                    : priorityRule?.mode === "static"
                      ? (data.priorities.find((p) => p.id === priorityRule.priorityId)?.name ?? "—")
                      : t("alt2.source.adv.fromPayload")}
                </code>
              </div>
              <div style={advRow}>
                <span style={{ color: "var(--ink-2)" }}>{t("alt2.source.adv.dedup")}</span>
                <code style={code}>{data.recent[0]?.dedupKey ?? t("alt2.source.adv.noneYet")}</code>
              </div>
              <div style={advRow}>
                <span style={{ color: "var(--ink-2)" }}>{t("alt2.source.adv.window")}</span>
                <span>{t.fmt.duration(windowMinutes)}</span>
              </div>
              {manages && (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 14,
                    borderTop: "1px solid var(--line-2)",
                    paddingTop: 14,
                  }}
                  data-testid="source-attributes"
                >
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
                  <PriorityRuleEditor
                    sourceId={source.id}
                    initial={source.priorityRule}
                    priorities={data.priorities}
                    paths={samplePaths}
                  />
                  <form
                    action={saveSourceFilter}
                    style={{ display: "flex", flexDirection: "column", gap: 10 }}
                  >
                    <input type="hidden" name="id" value={source.id} />
                    <ConditionsEditor
                      name="conditions"
                      initial={source.filter}
                      attributes={attrOptions.map((a) => ({ key: a.key, label: a.label }))}
                      emptyLabel={t("alt2.source.adv.filterEmpty")}
                    />
                    <div>
                      <button type="submit" className="oi-hover" style={btn}>
                        {t("common.save")}
                      </button>
                    </div>
                  </form>
                  <div data-testid="source-preview">
                    <PayloadTester sourceId={source.id} initialText={tester} />
                  </div>
                  <form
                    action={deleteSource}
                    style={{ display: "flex", justifyContent: "flex-end" }}
                  >
                    <input type="hidden" name="id" value={source.id} />
                    <button
                      type="submit"
                      className="oi-hover-dang"
                      style={{ ...btn, color: "var(--dang)" }}
                    >
                      {t("alt2.source.delete")}
                    </button>
                  </form>
                </div>
              )}
            </div>
          </Fold>

          <div style={{ ...card, overflow: "hidden" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                padding: "12px 18px",
                borderBottom: "1px solid var(--line)",
                fontSize: 13.5,
                fontWeight: 600,
              }}
            >
              {t("alt2.source.recent")}
              <span style={{ flex: 1 }} />
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  fontSize: 11,
                  color: "var(--ok)",
                  fontWeight: 600,
                }}
              >
                <span
                  className="oi-pulse"
                  style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--ok)" }}
                />
                {t("alt2.source.live")}
              </span>
            </div>
            {data.recent.map((r) => {
              const chip = priorityChip(r.rank);
              return (
                <Link
                  key={r.id}
                  href={`/app/alerts/${r.id}`}
                  className="oi-hover"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "10px 18px",
                    borderBottom: "1px solid var(--line-2)",
                    fontSize: 13,
                    color: "inherit",
                    textDecoration: "none",
                  }}
                >
                  <span
                    style={{
                      fontSize: 10.5,
                      fontWeight: 700,
                      borderRadius: 6,
                      padding: "1px 7px",
                      background: chip.bg,
                      color: chip.ink,
                      flex: "none",
                    }}
                  >
                    {r.attributes.priority ?? "—"}
                  </span>
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {r.title}
                  </span>
                  {r.testMode && (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        color: "var(--viol)",
                        background: "var(--viol-t)",
                        borderRadius: 5,
                        padding: "1px 6px",
                        flex: "none",
                      }}
                    >
                      {t("alt2.list.test")}
                    </span>
                  )}
                  <span style={{ fontSize: 11.5, color: "var(--ink-3)", flex: "none" }}>
                    {t.fmt.relativeCompact(r.firstAt)}
                  </span>
                </Link>
              );
            })}
            {data.recent.length === 0 && (
              <div style={{ padding: "18px", fontSize: 12.5, color: "var(--ink-3)" }}>
                {t("alt2.source.recentNone")}
              </div>
            )}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div
            style={{
              ...card,
              padding: "14px 16px",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div style={eyebrow}>{t("alt2.source.webhook")}</div>
            <code
              data-testid="source-endpoint"
              style={{
                fontFamily: "var(--mono)",
                fontSize: 11,
                background: "var(--sunk)",
                borderRadius: 8,
                padding: "8px 10px",
                wordBreak: "break-all",
                lineHeight: 1.5,
              }}
            >
              {endpoint}
            </code>
            <div style={{ fontSize: 12, color: "var(--ink-3)" }}>{t("alt2.source.secretNote")}</div>
          </div>

          <div
            style={{
              ...card,
              padding: "14px 16px",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div style={eyebrow}>{t("alt2.source.labelsSeen")}</div>
            {labelValues.size === 0 ? (
              <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
                {t("alt2.source.labelsNone")}
              </div>
            ) : (
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                {[...labelValues.entries()].map(([k, set]) => (
                  <span
                    key={k}
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 11,
                      background: "var(--sunk)",
                      borderRadius: 5,
                      padding: "2px 7px",
                    }}
                  >
                    {k} ({set.size})
                  </span>
                ))}
              </div>
            )}
            {data.unowned.length > 0 && (
              <>
                <div style={{ fontSize: 12, color: "var(--ink-2)", lineHeight: 1.5 }}>
                  {t("alt2.source.unowned", {
                    count: data.unowned.length,
                    names: data.unowned.map((s) => s.key).join(", "),
                  })}
                </div>
                <Link
                  href={`/app/services/${data.unowned[0]!.id}`}
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: "var(--brand)",
                    textDecoration: "none",
                  }}
                >
                  {t("alt2.source.assignOwner")}
                </Link>
              </>
            )}
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3,1fr)",
              gap: 1,
              background: "var(--line)",
              border: "1px solid var(--line)",
              borderRadius: 12,
              overflow: "hidden",
            }}
          >
            {[
              { label: t("alt2.source.received"), value: data.totals.received },
              { label: t("alt2.source.groupedCount"), value: data.totals.grouped },
              { label: t("alt2.source.toIncidents"), value: data.totals.incidents },
            ].map((x) => (
              <div key={x.label} style={{ background: "var(--panel)", padding: "10px 12px" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "var(--ink-3)" }}>
                  {x.label}
                </div>
                <div style={{ fontFamily: "var(--title)", fontSize: 18, fontWeight: 600 }}>
                  {t.fmt.number(x.value)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
