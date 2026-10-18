import { withTenant } from "@openincident/db";
import { getT } from "@/i18n/server";
import { recordAudit } from "@/lib/audit";
import { entitlementsFor } from "@/lib/entitlements";
import { hasPermission, requireMember } from "@/lib/session";
import { auditCounts, auditLines, parseArea } from "../data";
import { areaLabel, present } from "../present";

export const dynamic = "force-dynamic";

/** Enough for any real workspace's history; a bigger one is exported per area. */
const MAX_ROWS = 50_000;

function cell(v: string): string {
  // Quoted always; a leading formula character is neutralised so a
  // spreadsheet never evaluates a name somebody typed.
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return `"${safe.replace(/"/g, '""')}"`;
}

/**
 * GET /app/settings/audit/export?area=atlas — the audit log as CSV, with the
 * screen's filter: the time (UTC), who, the area, the sentence the screen
 * shows, and the raw action and target for a machine. Part of the advanced
 * audit log; the export itself is written in the log.
 */
export async function GET(request: Request) {
  const current = await requireMember();
  const t = await getT();
  if (!hasPermission(current.member, "audit.view"))
    return new Response("Forbidden", { status: 403 });
  if (!entitlementsFor(current.tenant).auditLogAdvanced)
    return new Response(t("settingsV2.audit.exportLocked"), { status: 403 });
  const area = parseArea(new URL(request.url).searchParams.get("area") ?? undefined);
  const counts = await auditCounts(current.tenant.id);
  const rows = await auditLines(current.tenant.id, area ? counts.keysOf[area] : null, 0, MAX_ROWS);
  const lines = [
    ["time", "actor", "area", "event", "action", "target"].map(cell).join(","),
    ...rows.map((r) => {
      const p = present(t, r);
      return [
        r.createdAt.toISOString(),
        r.actorName,
        areaLabel(t, p.area),
        p.sentence,
        r.action,
        JSON.stringify(r.target ?? {}),
      ]
        .map(cell)
        .join(",");
    }),
  ];
  await withTenant(current.tenant.id, (tx) =>
    recordAudit(tx, current, "security", "audit.exported", {
      area: area ?? "all",
      rows: rows.length,
    }),
  );
  const day = new Date().toISOString().slice(0, 10);
  return new Response(`\uFEFF${lines.join("\r\n")}\r\n`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="audit-${current.tenant.slug}-${area ?? "all"}-${day}.csv"`,
      "cache-control": "no-store",
    },
  });
}
