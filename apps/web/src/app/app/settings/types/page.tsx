import Link from "next/link";
import { and, asc, eq, gte } from "drizzle-orm";
import {
  catalogEntries,
  catalogTypes,
  incidentFields,
  incidentStatuses,
  incidentTypes,
  incidents,
  severities,
  withTenant,
} from "@openincident/db";
import { sql } from "drizzle-orm";
import { getT } from "@/i18n/server";
import { requireMember } from "@/lib/session";
import { severityInk } from "@/lib/tones";
import { saveSeverity, saveStatus } from "./actions";
import { NewTypeDialog } from "./new-type";

/**
 * Settings → Types & lifecycle: the type cards, then the selected type's
 * lifecycle strip — Triage → Active (its statuses as chips) → Post-incident →
 * Closed — with the selected node's card on the right; and the Severities
 * segment, one row per level with an inline editor. Statuses and severities
 * save for real. Creating a type and editing its declaration form land next.
 */
export default async function TypesPage({
  searchParams,
}: {
  searchParams: Promise<{
    type?: string;
    seg?: string;
    node?: string;
    sev?: string;
    saved?: string;
    error?: string;
  }>;
}) {
  const { tenant } = await requireMember();
  const t = await getT();
  const params = await searchParams;
  const data = await withTenant(tenant.id, async (tx) => {
    const types = await tx
      .select()
      .from(incidentTypes)
      .where(eq(incidentTypes.tenantId, tenant.id))
      .orderBy(asc(incidentTypes.position));
    const statuses = await tx
      .select()
      .from(incidentStatuses)
      .where(eq(incidentStatuses.tenantId, tenant.id))
      .orderBy(asc(incidentStatuses.rank));
    const sevs = await tx
      .select()
      .from(severities)
      .where(eq(severities.tenantId, tenant.id))
      .orderBy(asc(severities.rank));
    const fields = await tx
      .select()
      .from(incidentFields)
      .where(eq(incidentFields.tenantId, tenant.id))
      .orderBy(asc(incidentFields.position));
    const since = new Date(Date.now() - 90 * 86_400_000);
    const counts = await tx
      .select({ typeId: incidents.typeId, n: sql<number>`count(*)`.mapWith(Number) })
      .from(incidents)
      .where(and(eq(incidents.tenantId, tenant.id), gte(incidents.declaredAt, since)))
      .groupBy(incidents.typeId);
    return { types, statuses, sevs, fields, counts: new Map(counts.map((c) => [c.typeId, c.n])) };
  });
  const seg = params.seg === "severities" ? "severities" : "types";
  const type =
    data.types.find((ty) => ty.id === params.type) ??
    data.types.find((ty) => ty.isDefault) ??
    data.types[0];
  if (!type) return null;
  const statuses = data.statuses.filter((s) => s.typeId === type.id);
  const node = params.node ?? statuses[0]?.id ?? "triage";
  const nodeStatus = statuses.find((s) => s.id === node);
  const href = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ type: type.id, seg, node, ...patch })) if (v) p.set(k, v);
    return `/app/settings/types?${p.toString()}`;
  };
  const label: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: ".1em",
    textTransform: "uppercase",
    color: "var(--ink-3)",
  };
  const control: React.CSSProperties = {
    height: 34,
    padding: "0 11px",
    border: "1px solid var(--line)",
    borderRadius: 9,
    outline: "none",
    fontSize: 12.5,
    background: "var(--panel)",
    width: "100%",
  };

  const phaseCard = (
    key: string,
    title: string,
    sub: string,
    ink: string,
    bg: string,
    line: string,
  ) => {
    const on = node === key;
    return (
      <Link
        href={href({ node: key })}
        style={{
          flex: 1,
          minWidth: 128,
          border: `1px solid ${line}`,
          borderRadius: 11,
          padding: "10px 12px",
          background: bg,
          textDecoration: "none",
          color: "inherit",
          boxShadow: on ? "0 0 0 2px var(--brand-b)" : "none",
        }}
      >
        <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".08em", color: ink }}>
          {title}
        </div>
        <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 4 }}>{sub}</div>
      </Link>
    );
  };
  const arrow = (
    <div style={{ display: "flex", alignItems: "center", color: "var(--ink-3)" }}>→</div>
  );
  const postRule =
    type.postIncidentFromRank === null
      ? t("settings.types.postNever")
      : type.postIncidentFromRank === -1
        ? t("settings.types.postAlways")
        : t("settings.types.postFrom", {
            severity: data.sevs.find((s) => s.rank === type.postIncidentFromRank)?.name ?? "—",
          });

  const teams = await withTenant(tenant.id, (tx) =>
    tx
      .select({ id: catalogEntries.id, name: catalogEntries.name })
      .from(catalogEntries)
      .innerJoin(catalogTypes, eq(catalogTypes.id, catalogEntries.typeId))
      .where(and(eq(catalogEntries.tenantId, tenant.id), eq(catalogTypes.key, "team")))
      .orderBy(asc(catalogEntries.name)),
  );

  return (
    <div
      className="oi-rise"
      style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 1080 }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 className="oi-title" style={{ margin: 0 }}>
          {t("settings.types.title")}
        </h1>
        <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
          {t("settings.types.subtitle")}
        </span>
        <span style={{ flex: 1 }} />
        {params.saved === "1" && (
          <span role="status" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ok)" }}>
            {t("common.saved")}
          </span>
        )}
        {params.error && (
          <span role="alert" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--dang)" }}>
            {params.error === "duplicate"
              ? t("settings.types.errorDuplicate")
              : t("settings.fields.errorInvalid")}
          </span>
        )}
        <NewTypeDialog
          types={data.types.map((ty) => ({ id: ty.id, name: ty.name, isDefault: ty.isDefault }))}
          teams={teams}
        />
        <div
          role="tablist"
          style={{
            display: "flex",
            gap: 2,
            background: "var(--sunk)",
            borderRadius: 10,
            padding: 3,
          }}
        >
          {(["types", "severities"] as const).map((s) => {
            const on = seg === s;
            return (
              <Link
                key={s}
                role="tab"
                aria-selected={on}
                href={href({ seg: s })}
                style={{
                  height: 28,
                  padding: "0 14px",
                  borderRadius: 8,
                  background: on ? "var(--panel)" : "transparent",
                  color: on ? "var(--ink)" : "var(--ink-3)",
                  boxShadow: on ? "var(--shadow-card)" : "none",
                  display: "flex",
                  alignItems: "center",
                  fontSize: 12.5,
                  fontWeight: 600,
                  textDecoration: "none",
                }}
              >
                {s === "types" ? t("settings.types.segTypes") : t("settings.types.segSeverities")}
              </Link>
            );
          })}
        </div>
      </div>

      {seg === "types" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "stretch" }}>
            {data.types.map((ty) => {
              const on = ty.id === type.id;
              const badge = ty.isDefault
                ? { l: t("settings.types.badgeSeeded"), bg: "var(--sunk)", ink: "var(--ink-2)" }
                : ty.restrictedToTeamIds && ty.restrictedToTeamIds.length > 0
                  ? {
                      l: t("settings.types.badgeRestricted"),
                      bg: "var(--viol-t)",
                      ink: "var(--viol)",
                    }
                  : ty.privateByDefault
                    ? {
                        l: t("settings.types.badgePrivate"),
                        bg: "var(--viol-t)",
                        ink: "var(--viol)",
                      }
                    : {
                        l: t("settings.types.badgeSpecific"),
                        bg: "var(--sunk)",
                        ink: "var(--ink-2)",
                      };
              return (
                <Link
                  key={ty.id}
                  href={`/app/settings/types?type=${ty.id}`}
                  className="oi-hover-edge"
                  style={{
                    flex: "1 1 210px",
                    maxWidth: 280,
                    display: "flex",
                    flexDirection: "column",
                    gap: 5,
                    padding: "13px 15px",
                    background: "var(--panel)",
                    border: `1.5px solid ${on ? "var(--brand)" : "var(--line)"}`,
                    borderRadius: 13,
                    boxShadow: on ? "var(--shadow-card-hover)" : "var(--shadow-card)",
                    textDecoration: "none",
                    color: "inherit",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{ty.name}</span>
                    <span
                      style={{
                        padding: "1px 8px",
                        borderRadius: 999,
                        background: badge.bg,
                        color: badge.ink,
                        fontSize: 10.5,
                        fontWeight: 700,
                      }}
                    >
                      {badge.l}
                    </span>
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--ink-3)", lineHeight: 1.45 }}>
                    {ty.description}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--ink-3)",
                      fontVariantNumeric: "tabular-nums",
                      marginTop: "auto",
                    }}
                  >
                    {t("catalog.meta.incidents", { count: data.counts.get(ty.id) ?? 0 })}
                  </div>
                </Link>
              );
            })}
          </div>
          <div className="oi-panel" style={{ overflow: "hidden" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "11px 18px",
                borderBottom: "1px solid var(--line)",
                flexWrap: "wrap",
              }}
            >
              <span style={{ fontFamily: "var(--font-title)", fontSize: 15, fontWeight: 600 }}>
                {type.name}
              </span>
              <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
                {t("settings.types.lifecycle")}
              </span>
            </div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 14,
                padding: "16px 18px",
                alignItems: "flex-start",
              }}
            >
              <div
                style={{
                  flex: "10 1 400px",
                  minWidth: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
              >
                <div style={{ display: "flex", alignItems: "stretch", gap: 8, flexWrap: "wrap" }}>
                  {phaseCard(
                    "triage",
                    t("settings.types.phaseTriage"),
                    t("settings.types.phaseTriageSub"),
                    "var(--viol)",
                    "var(--viol-t)",
                    "var(--viol)",
                  )}
                  {arrow}
                  <div
                    style={{
                      flex: 2,
                      minWidth: 230,
                      border: "1px solid var(--open)",
                      borderRadius: 11,
                      padding: "10px 12px",
                      background: "var(--open-t)",
                      boxShadow: nodeStatus ? "0 0 0 2px var(--brand-b)" : "none",
                    }}
                  >
                    <div
                      style={{
                        fontSize: 10.5,
                        fontWeight: 700,
                        letterSpacing: ".08em",
                        color: "var(--open)",
                      }}
                    >
                      {t("settings.types.phaseActive")}
                    </div>
                    <div style={{ display: "flex", gap: 5, marginTop: 6, flexWrap: "wrap" }}>
                      {statuses.map((s) => {
                        const on = node === s.id;
                        return (
                          <Link
                            key={s.id}
                            href={href({ node: s.id })}
                            style={{
                              fontSize: 11.5,
                              fontWeight: 600,
                              background: on ? "var(--brand)" : "var(--panel)",
                              color: on ? "#fff" : "var(--ink)",
                              border: `1px solid ${on ? "var(--brand)" : "var(--line)"}`,
                              borderRadius: 999,
                              padding: "3px 10px",
                              textDecoration: "none",
                            }}
                          >
                            {s.name}
                          </Link>
                        );
                      })}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 6 }}>
                      {t("settings.types.phaseActiveSub")}
                    </div>
                  </div>
                  {arrow}
                  {phaseCard(
                    "post",
                    t("settings.types.phasePost"),
                    t("settings.types.phasePostSub"),
                    "var(--brand)",
                    "var(--brand-t)",
                    "var(--brand-b)",
                  )}
                  {arrow}
                  {phaseCard(
                    "closed",
                    t("settings.types.phaseClosed"),
                    t("settings.types.phaseClosedSub"),
                    "var(--ink-2)",
                    "var(--panel)",
                    "var(--line)",
                  )}
                </div>
                <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                  {t("settings.types.lifecycleNote")}
                </div>
                <div style={{ borderTop: "1px solid var(--line-2)", paddingTop: 12 }}>
                  <div style={label}>{t("settings.types.declareForm")}</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                    {type.declareForm.map((f) => {
                      const custom = data.fields.find((x) => x.key === f.key);
                      const name = custom
                        ? custom.label
                        : t(
                            `settings.types.systemField.${f.key as "title" | "severity" | "service" | "summary"}`,
                          );
                      return (
                        <span
                          key={f.key}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                            padding: "3px 10px",
                            borderRadius: 999,
                            background: f.required ? "var(--brand-t)" : "var(--sunk)",
                            color: f.required ? "var(--brand)" : "var(--ink-2)",
                            fontSize: 11.5,
                            fontWeight: 600,
                            fontFamily:
                              custom && /^[a-z_]+$/.test(name) ? "var(--font-mono)" : undefined,
                          }}
                        >
                          {name}
                          <span style={{ fontWeight: 400, opacity: 0.7 }}>
                            {f.required
                              ? t("settings.types.required")
                              : t("settings.types.optional")}
                          </span>
                        </span>
                      );
                    })}
                  </div>
                </div>
              </div>
              <div
                style={{
                  flex: "1 1 250px",
                  maxWidth: 320,
                  minWidth: 240,
                  background: "var(--sunk)",
                  borderRadius: 12,
                  padding: "14px 15px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                {nodeStatus ? (
                  <form
                    action={saveStatus}
                    style={{ display: "flex", flexDirection: "column", gap: 10 }}
                  >
                    <input type="hidden" name="statusId" value={nodeStatus.id} />
                    <input type="hidden" name="typeId" value={type.id} />
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          background: "var(--open)",
                          flex: "none",
                        }}
                      />
                      <span style={{ fontSize: 13.5, fontWeight: 600 }}>{nodeStatus.name}</span>
                      <span style={{ flex: 1 }} />
                      <span
                        style={{
                          padding: "1px 8px",
                          borderRadius: 999,
                          background: "var(--panel)",
                          border: "1px solid var(--line)",
                          color: "var(--ink-3)",
                          fontSize: 10,
                          fontWeight: 700,
                          textTransform: "uppercase",
                          letterSpacing: ".06em",
                        }}
                      >
                        {t("settings.types.kindStatus")}
                      </span>
                    </div>
                    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <span style={label}>{t("settings.types.statusName")}</span>
                      <input
                        name="name"
                        defaultValue={nodeStatus.name}
                        required
                        maxLength={60}
                        className="oi-field"
                        style={control}
                      />
                    </label>
                    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <span style={label}>{t("settings.types.statusDescription")}</span>
                      <input
                        name="description"
                        defaultValue={nodeStatus.description ?? ""}
                        maxLength={200}
                        className="oi-field"
                        style={control}
                      />
                    </label>
                    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <span style={label}>{t("settings.types.updateReminder")}</span>
                      <select
                        name="updateReminderMinutes"
                        defaultValue={String(nodeStatus.updateReminderMinutes ?? "")}
                        className="oi-field"
                        style={control}
                      >
                        <option value="">{t("incident.update.noReminder")}</option>
                        {[15, 30, 60, 120].map((m) => (
                          <option key={m} value={m}>
                            {t("incident.update.inMinutes", { count: m })}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <span style={label}>{t("settings.types.publicStatus")}</span>
                      <select
                        name="publicStatus"
                        defaultValue={nodeStatus.publicStatus ?? ""}
                        className="oi-field"
                        style={control}
                      >
                        <option value="">— ({t("settings.types.publicNone")})</option>
                        {["investigating", "identified", "monitoring"].map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label
                      style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}
                    >
                      <input
                        type="checkbox"
                        name="countsInMttr"
                        defaultChecked={nodeStatus.countsInMttr}
                      />{" "}
                      {t("settings.types.countsInMttr")}
                    </label>
                    <button
                      type="submit"
                      style={{
                        height: 30,
                        borderRadius: 8,
                        background: "var(--brand)",
                        color: "#fff",
                        border: 0,
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      {t("common.save")}
                    </button>
                  </form>
                ) : (
                  <>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          background:
                            node === "triage"
                              ? "var(--viol)"
                              : node === "post"
                                ? "var(--brand)"
                                : "var(--ink-3)",
                          flex: "none",
                        }}
                      />
                      <span style={{ fontSize: 13.5, fontWeight: 600 }}>
                        {node === "triage"
                          ? t("settings.types.phaseTriage")
                          : node === "post"
                            ? t("settings.types.phasePost")
                            : t("settings.types.phaseClosed")}
                      </span>
                      <span style={{ flex: 1 }} />
                      <span
                        style={{
                          padding: "1px 8px",
                          borderRadius: 999,
                          background: "var(--panel)",
                          border: "1px solid var(--line)",
                          color: "var(--ink-3)",
                          fontSize: 10,
                          fontWeight: 700,
                          textTransform: "uppercase",
                          letterSpacing: ".06em",
                        }}
                      >
                        {t("settings.types.kindPhase")}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--ink-2)", lineHeight: 1.55 }}>
                      {node === "triage"
                        ? t("settings.types.triageDesc")
                        : node === "post"
                          ? t("settings.types.postDesc")
                          : t("settings.types.closedDesc")}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column" }}>
                      {(node === "triage"
                        ? [
                            [t("settings.types.row.actions"), t("settings.types.phaseTriageSub")],
                            [t("settings.types.row.entry"), t("settings.types.triageEntry")],
                          ]
                        : node === "post"
                          ? [
                              [t("settings.types.row.autoEntry"), postRule],
                              [t("settings.types.row.exit"), t("settings.types.postExit")],
                            ]
                          : [
                              [t("settings.types.row.skip"), t("settings.types.closedSkip")],
                              [t("settings.types.row.reopen"), t("settings.types.closedReopen")],
                            ]
                      ).map(([l, v]) => (
                        <div
                          key={l}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            gap: 12,
                            fontSize: 12,
                            padding: "7px 0",
                            borderBottom: "1px solid var(--line-2)",
                          }}
                        >
                          <span style={{ color: "var(--ink-3)", flex: "none" }}>{l}</span>
                          <span style={{ fontWeight: 600, textAlign: "right" }}>{v}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="oi-panel" style={{ overflow: "hidden" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "12px 18px",
                borderBottom: "1px solid var(--line)",
              }}
            >
              <span style={{ fontSize: 14, fontWeight: 600 }}>
                {t("settings.types.segSeverities")}
              </span>
              <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
                {t("settings.types.severitiesSub")}
              </span>
            </div>
            {data.sevs.map((sv) => {
              const open = params.sev === sv.id;
              return (
                <div key={sv.id}>
                  <Link
                    href={href({ sev: open ? undefined : sv.id })}
                    className="oi-hover"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "10px 18px",
                      borderBottom: "1px solid var(--line-2)",
                      textDecoration: "none",
                      color: "inherit",
                    }}
                  >
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: severityInk(sv.rank),
                        flex: "none",
                      }}
                    />
                    <span
                      style={{
                        width: 52,
                        fontFamily: "var(--font-mono)",
                        fontSize: 12,
                        fontWeight: 500,
                        flex: "none",
                      }}
                    >
                      {sv.name}
                    </span>
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        fontSize: 12.5,
                        color: "var(--ink-2)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {sv.description}
                    </span>
                    <span
                      style={{
                        padding: "2px 9px",
                        borderRadius: 999,
                        background: "var(--sunk)",
                        color: "var(--ink-2)",
                        fontSize: 10.5,
                        fontWeight: 700,
                        flex: "none",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {t("settings.types.postIncidentLabel")} :{" "}
                      {t(`settings.types.postIncident.${sv.postIncident}`)}
                    </span>
                    <span style={{ color: "var(--ink-3)", fontSize: 10, flex: "none" }}>
                      {open ? "▴" : "▾"}
                    </span>
                  </Link>
                  {open && (
                    <form
                      action={saveSeverity}
                      className="oi-rise"
                      style={{
                        padding: "14px 18px 16px 47px",
                        background: "var(--sunk)",
                        borderBottom: "1px solid var(--line-2)",
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                      }}
                    >
                      <input type="hidden" name="severityId" value={sv.id} />
                      <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 10 }}>
                        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          <span style={label}>{t("settings.types.statusName")}</span>
                          <input
                            name="name"
                            defaultValue={sv.name}
                            required
                            maxLength={20}
                            className="oi-field"
                            style={{ ...control, fontFamily: "var(--font-mono)", fontSize: 12 }}
                          />
                        </label>
                        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          <span style={label}>{t("settings.types.statusDescription")}</span>
                          <input
                            name="description"
                            defaultValue={sv.description ?? ""}
                            maxLength={200}
                            className="oi-field"
                            style={control}
                          />
                        </label>
                      </div>
                      <div
                        style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}
                      >
                        <span style={{ fontSize: 12.5, fontWeight: 600 }}>
                          {t("settings.types.postIncidentEntry")}
                        </span>
                        <select
                          name="postIncident"
                          defaultValue={sv.postIncident}
                          className="oi-field"
                          style={{ ...control, width: "auto", height: 32 }}
                        >
                          {(["always", "yes", "opt_in", "never"] as const).map((v) => (
                            <option key={v} value={v}>
                              {t(`settings.types.postIncident.${v}`)}
                            </option>
                          ))}
                        </select>
                        <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                          {t("settings.types.postIncidentHint")}
                        </span>
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          type="submit"
                          style={{
                            height: 32,
                            padding: "0 16px",
                            borderRadius: 9,
                            background: "var(--brand)",
                            color: "#fff",
                            border: 0,
                            fontSize: 12.5,
                            fontWeight: 600,
                            cursor: "pointer",
                          }}
                        >
                          {t("common.save")}
                        </button>
                        <Link
                          href={href({ sev: undefined })}
                          style={{
                            height: 32,
                            padding: "0 12px",
                            border: "1px solid var(--line)",
                            borderRadius: 9,
                            background: "var(--panel)",
                            display: "flex",
                            alignItems: "center",
                            fontSize: 12.5,
                            textDecoration: "none",
                            color: "inherit",
                          }}
                        >
                          {t("common.cancel")}
                        </Link>
                      </div>
                    </form>
                  )}
                </div>
              );
            })}
          </div>
          <div className="oi-note">{t("settings.types.severityNote")}</div>
        </div>
      )}
    </div>
  );
}
