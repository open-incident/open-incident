import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { decryptSecret } from "@openincident/crypto";
import { catalogEntries, catalogTypes, heartbeats, withTenant } from "@openincident/db";
import { isManagerRole } from "@openincident/config";
import { heartbeatPingUrl } from "@openincident/oncall";
import { getT } from "@/i18n/server";
import { requireMember } from "@/lib/session";
import { currentOrigin } from "@/lib/tenant";
import { CopyField } from "@/components/copy-field";
import { createHeartbeat, deleteHeartbeat, rotateHeartbeatToken, toggleHeartbeat } from "./actions";

/**
 * Settings → Heartbeats: one row per cron or job that must keep pinging, its
 * URL, its cadence, its last ping and an honest status — waiting until the
 * first ping, up, or down with an alert raised through the Heartbeats source.
 */
export default async function HeartbeatsPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string; created?: string; rotated?: string; error?: string }>;
}) {
  const { tenant, member } = await requireMember();
  const t = await getT();
  const q = await searchParams;
  const origin = await currentOrigin();
  const manages = isManagerRole(member);
  const data = await withTenant(tenant.id, async (tx) => {
    const rows = await tx
      .select({ hb: heartbeats, serviceName: catalogEntries.name })
      .from(heartbeats)
      .leftJoin(catalogEntries, eq(catalogEntries.id, heartbeats.serviceEntryId))
      .where(eq(heartbeats.tenantId, tenant.id))
      .orderBy(asc(heartbeats.name));
    const [svcType] = await tx
      .select({ id: catalogTypes.id })
      .from(catalogTypes)
      .where(eq(catalogTypes.key, "service"));
    const services = svcType
      ? await tx
          .select({ id: catalogEntries.id, name: catalogEntries.name })
          .from(catalogEntries)
          .where(eq(catalogEntries.typeId, svcType.id))
          .orderBy(asc(catalogEntries.name))
      : [];
    return { rows, services };
  });
  const tone = (s: "waiting" | "up" | "down") =>
    s === "up"
      ? { bg: "var(--ok-t)", ink: "var(--ok)" }
      : s === "down"
        ? { bg: "var(--dang-t)", ink: "var(--dang)" }
        : { bg: "var(--sunk)", ink: "var(--ink-3)" };
  const dur = (sec: number) =>
    sec % 86_400 === 0
      ? t("heartbeats.days", { count: sec / 86_400 })
      : sec % 3600 === 0
        ? t("heartbeats.hours", { count: sec / 3600 })
        : sec % 60 === 0
          ? t("heartbeats.minutes", { count: sec / 60 })
          : t("heartbeats.seconds", { count: sec });
  const label: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: ".1em",
    textTransform: "uppercase",
    color: "var(--ink-3)",
  };
  const control: React.CSSProperties = {
    height: 38,
    padding: "0 12px",
    border: "1px solid var(--line)",
    borderRadius: 10,
    outline: "none",
    fontSize: 13.5,
    background: "var(--panel)",
    width: "100%",
  };
  const ghostBtn: React.CSSProperties = {
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
  const brandBtn: React.CSSProperties = {
    height: 34,
    padding: "0 14px",
    borderRadius: 9,
    background: "var(--brand)",
    color: "#fff",
    border: 0,
    fontSize: 12.5,
    fontWeight: 600,
    cursor: "pointer",
    textDecoration: "none",
    display: "inline-flex",
    alignItems: "center",
  };
  const down = data.rows.filter((r) => r.hb.status === "down").length;

  return (
    <div
      className="oi-rise"
      style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 980 }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 className="oi-title" style={{ margin: 0 }}>
          {t("heartbeats.title")}
        </h1>
        <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
          {data.rows.length === 0
            ? t("heartbeats.subtitleEmpty")
            : down > 0
              ? t("heartbeats.subtitleDown", { count: data.rows.length, down })
              : t("heartbeats.subtitle", { count: data.rows.length })}
        </span>
        <span style={{ flex: 1 }} />
        {manages && (
          <Link href="/app/settings/heartbeats?new=1" data-testid="heartbeat-new" style={brandBtn}>
            {t("heartbeats.new")}
          </Link>
        )}
      </div>
      <div className="oi-note">{t("heartbeats.intro")}</div>
      <div className="oi-panel" style={{ overflow: "hidden" }}>
        {data.rows.length === 0 && (
          <div style={{ padding: 20, fontSize: 13, color: "var(--ink-3)" }}>
            {t("heartbeats.empty")}
          </div>
        )}
        {data.rows.map(({ hb, serviceName }) => {
          const tn = tone(hb.status);
          const token = manages ? decryptSecret(hb.encryptedToken) : null;
          const highlight = q.created === hb.id || q.rotated === hb.id;
          return (
            <div
              key={hb.id}
              data-testid="heartbeat-row"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                padding: "12px 16px",
                borderBottom: "1px solid var(--line-2)",
                background: highlight ? "var(--brand-t)" : undefined,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span
                  data-testid="heartbeat-status"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "2px 9px 2px 7px",
                    borderRadius: 999,
                    background: tn.bg,
                    color: tn.ink,
                    fontSize: 10.5,
                    fontWeight: 700,
                    flex: "none",
                  }}
                >
                  <span
                    style={{ width: 5, height: 5, borderRadius: "50%", background: "currentColor" }}
                  />
                  {t(`heartbeats.status.${hb.status}`)}
                  {!hb.active ? ` · ${t("heartbeats.paused")}` : ""}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{hb.name}</div>
                  <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                    {t("heartbeats.cadence", {
                      interval: dur(hb.intervalSeconds),
                      grace: dur(hb.graceSeconds),
                    })}
                    {serviceName ? ` · ${serviceName}` : ""}
                    {hb.description ? ` · ${hb.description}` : ""}
                  </div>
                </div>
                <span style={{ fontSize: 12, color: "var(--ink-3)", whiteSpace: "nowrap" }}>
                  {hb.lastPingAt
                    ? t("heartbeats.lastPing", { when: t.fmt.relative(hb.lastPingAt) })
                    : t("heartbeats.neverPinged")}
                </span>
                {manages && (
                  <div style={{ display: "flex", gap: 6, flex: "none" }}>
                    <form action={toggleHeartbeat}>
                      <input type="hidden" name="id" value={hb.id} />
                      <button type="submit" className="oi-hover" style={ghostBtn}>
                        {hb.active ? t("heartbeats.pause") : t("heartbeats.resume")}
                      </button>
                    </form>
                    <form action={rotateHeartbeatToken}>
                      <input type="hidden" name="id" value={hb.id} />
                      <button
                        type="submit"
                        className="oi-hover"
                        style={ghostBtn}
                        title={t("heartbeats.rotateHint")}
                      >
                        {t("heartbeats.rotate")}
                      </button>
                    </form>
                    <form action={deleteHeartbeat}>
                      <input type="hidden" name="id" value={hb.id} />
                      <button
                        type="submit"
                        className="oi-hover-dang"
                        style={{ ...ghostBtn, color: "var(--dang)" }}
                        aria-label={t("common.delete")}
                      >
                        ✕
                      </button>
                    </form>
                  </div>
                )}
              </div>
              {token && (
                <CopyField value={heartbeatPingUrl(origin, hb.id, token)} testId="heartbeat-url" />
              )}
            </div>
          );
        })}
      </div>
      {q.new === "1" && manages && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "var(--scrim-dialog)",
            display: "grid",
            placeItems: "center",
            padding: 24,
            zIndex: 60,
          }}
        >
          <form
            action={createHeartbeat}
            data-testid="heartbeat-form"
            role="dialog"
            className="oi-rise"
            style={{
              width: 520,
              maxWidth: "100%",
              background: "var(--panel)",
              borderRadius: 18,
              boxShadow: "var(--shadow-modal)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "16px 20px",
                borderBottom: "1px solid var(--line)",
              }}
            >
              <div style={{ fontFamily: "var(--font-title)", fontSize: 16.5, fontWeight: 600 }}>
                {t("heartbeats.new")}
              </div>
              <Link
                href="/app/settings/heartbeats"
                aria-label={t("common.close")}
                style={{
                  marginLeft: "auto",
                  width: 30,
                  height: 30,
                  borderRadius: 8,
                  display: "grid",
                  placeItems: "center",
                  color: "var(--ink-3)",
                  fontSize: 14,
                  textDecoration: "none",
                }}
              >
                ✕
              </Link>
            </div>
            <div
              style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 12 }}
            >
              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={label}>{t("heartbeats.name")}</span>
                <input
                  name="name"
                  required
                  minLength={2}
                  maxLength={120}
                  placeholder={t("heartbeats.namePlaceholder")}
                  className="oi-field"
                  style={control}
                  autoFocus
                />
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={label}>{t("heartbeats.interval")}</span>
                  <select
                    name="intervalSeconds"
                    defaultValue="3600"
                    className="oi-field"
                    style={control}
                  >
                    {[60, 300, 900, 1800, 3600, 21_600, 43_200, 86_400, 604_800].map((s) => (
                      <option key={s} value={s}>
                        {dur(s)}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={label}>{t("heartbeats.grace")}</span>
                  <select
                    name="graceSeconds"
                    defaultValue="300"
                    className="oi-field"
                    style={control}
                  >
                    {[0, 60, 300, 900, 1800, 3600, 21_600].map((s) => (
                      <option key={s} value={s}>
                        {s === 0 ? t("heartbeats.noGrace") : dur(s)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={label}>{t("heartbeats.service")}</span>
                <select name="serviceEntryId" defaultValue="" className="oi-field" style={control}>
                  <option value="">—</option>
                  {data.services.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={label}>{t("heartbeats.description")}</span>
                <input name="description" maxLength={500} className="oi-field" style={control} />
              </label>
              {q.error === "invalid" && (
                <div role="alert" style={{ fontSize: 12.5, color: "var(--dang)" }}>
                  {t("heartbeats.invalid")}
                </div>
              )}
              <div
                style={{
                  background: "var(--sunk)",
                  borderRadius: 11,
                  padding: "11px 13px",
                  fontSize: 12,
                  color: "var(--ink-2)",
                  lineHeight: 1.5,
                }}
              >
                {t("heartbeats.createNote")}
              </div>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "14px 20px",
                borderTop: "1px solid var(--line)",
              }}
            >
              <span style={{ flex: 1 }} />
              <Link href="/app/settings/heartbeats" className="oi-hover" style={ghostBtn}>
                {t("common.cancel")}
              </Link>
              <button type="submit" data-testid="heartbeat-save" style={brandBtn}>
                {t("common.create")}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
