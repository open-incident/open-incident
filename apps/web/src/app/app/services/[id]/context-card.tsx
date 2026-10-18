import Link from "next/link";
import { withTenant } from "@openincident/db";
import { getT } from "@/i18n/server";
import { serviceContext } from "@/lib/services";
import { CARD } from "./ui";

/**
 * ✦ Context — what the workspace's records say about this service, each
 * statement with the record it comes from.
 *
 * Read from rows, not written by a model: the changes its incidents followed,
 * the root cause its last post-mortem wrote down, how fast its incidents
 * resolve against the rest. Quoted text is data from the workspace and is
 * shown as such, never interpreted.
 */
export async function ContextCard({
  tenantId,
  serviceId,
}: {
  tenantId: string;
  serviceId: string;
}) {
  const t = await getT();
  const { facts, cites } = await withTenant(tenantId, (tx) =>
    serviceContext(tx, tenantId, serviceId),
  );
  const sentences = facts.map((f) => {
    if (f.kind === "changes") {
      const list = f.incidents.map((n) => `INC-${n}`).join(", ");
      return f.incidents.length > 1
        ? t("services.ctxChanges", { count: f.incidents.length, other: f.other, list })
        : t("services.ctxChangeOnce", { other: f.other, list });
    }
    if (f.kind === "rootCause")
      return t("services.ctxRootCause", { incident: `INC-${f.incident}`, excerpt: f.excerpt });
    return t("services.ctxResolve", {
      mine: t.fmt.duration(f.mine),
      all: t.fmt.duration(f.all),
    });
  });

  return (
    <div style={CARD} data-testid="service-context">
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ color: "var(--viol)" }}>✦</span>
        <span style={{ fontSize: 13.5, fontWeight: 600 }}>{t("services.context")}</span>
        <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{t("services.contextSub")}</span>
      </div>
      <div style={{ fontSize: 12.5, lineHeight: 1.55, color: "var(--ink-2)" }}>
        {sentences.length > 0 ? sentences.join(" ") : t("services.contextEmpty")}
      </div>
      {cites.length > 0 && (
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {cites.map((c) => (
            <Link
              key={`${c.label}:${c.incident}`}
              href={
                c.label === "postMortem"
                  ? `/app/incidents/${c.incident}?tab=post-incident`
                  : `/app/incidents/${c.incident}`
              }
              style={{
                fontSize: 10.5,
                border: "1px solid var(--line)",
                borderRadius: 6,
                padding: "2px 7px",
                color: "var(--ink-3)",
                textDecoration: "none",
              }}
            >
              {c.label === "postMortem"
                ? t("services.citePostMortem", { incident: `INC-${c.incident}` })
                : t("services.citeTimeline", { incident: `INC-${c.incident}` })}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
