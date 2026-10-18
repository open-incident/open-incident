import Link from "next/link";
import { getT } from "@/i18n/server";
import { atlasAvailable, firstToldOf, resolvedByAtlasSince } from "./data";

/** Midnight at the start of yesterday, in the reader's time zone. */
function startOfYesterday(timeZone: string): Date {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const sinceMidnight = (n("hour") * 3600 + n("minute") * 60 + n("second")) * 1000;
  return new Date(now.getTime() - sinceMidnight - 86_400_000);
}

/**
 * "Atlas resolved N incidents on its own since yesterday · Review N →" — the
 * violet line on Home, over everything else, when Atlas worked overnight.
 * Hidden when N = 0. Owner: atlas-ui.
 */
export async function AtlasHomeBanner({ tenantId }: { tenantId: string }) {
  if (!(await atlasAvailable())) return null;
  const t = await getT();
  const list = await resolvedByAtlasSince(tenantId, startOfYesterday(t.timeZone));
  if (list.length === 0) return null;
  const told = await firstToldOf(
    tenantId,
    list.map((r) => r.incidentId),
  );
  const pending = list.filter((r) => r.reviewState === "pending" || r.reviewState == null).length;
  const items = list.slice(0, 3).map((r) => {
    const who = r.alone ? null : told.get(r.incidentId);
    return t("atlas.ui.home.item", {
      number: r.number,
      service: r.serviceKey ?? "—",
      time: t.fmt.time(r.declaredAt, t.timeZone),
      who: who
        ? t("atlas.ui.home.told", { name: who.name.split(" ")[0] ?? who.name })
        : t("atlas.ui.home.nobody"),
    });
  });
  const more = list.length > 3 ? ` · ${t("atlas.ui.more", { count: list.length - 3 })}` : "";
  return (
    <Link
      href="/app/incidents?tab=atlas"
      data-testid="atlas-home-banner"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
        background: "var(--viol-t)",
        border: "1px solid var(--viol)",
        borderRadius: "var(--radius-card)",
        padding: "12px 16px",
        cursor: "pointer",
        color: "var(--ink)",
        textDecoration: "none",
      }}
    >
      <span style={{ color: "var(--viol)", fontSize: 16 }}>✦</span>
      <div style={{ flex: "1 1 320px", minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>
          {t("atlas.ui.home.title", { count: list.length })}
        </div>
        <div style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 2 }}>
          {items.join(" · ")}
          {more}. {t("atlas.ui.home.tail", { count: list.length })}
        </div>
      </div>
      <span
        style={{
          height: 32,
          padding: "0 13px",
          borderRadius: 9,
          background: "var(--viol)",
          color: "#fff",
          display: "flex",
          alignItems: "center",
          fontSize: 12.5,
          fontWeight: 600,
          whiteSpace: "nowrap",
        }}
      >
        {pending > 0 ? t("atlas.ui.home.review", { count: pending }) : t("atlas.ui.home.see")}
      </span>
    </Link>
  );
}
