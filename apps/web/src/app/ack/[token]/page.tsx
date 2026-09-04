import { notFound } from "next/navigation";
import { getT } from "@/i18n/server";
import { getTenantFromHeaders } from "@/lib/tenant";
import { ackByToken, describeAckToken } from "@/lib/ack";

export const dynamic = "force-dynamic";

async function acknowledge(formData: FormData) {
  "use server";
  const tenant = await getTenantFromHeaders();
  const token = String(formData.get("token") ?? "");
  if (!tenant) return;
  await ackByToken(tenant.id, token, "link");
}

/**
 * The public acknowledgement page a page link opens — mobile-first, one
 * button, no sign-in: the token in the link is the proof it reached the person
 * who was paged. It says what happened, and never pretends when it is too late.
 */
export default async function AckPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ done?: string }>;
}) {
  const { token } = await params;
  const q = await searchParams;
  const tenant = await getTenantFromHeaders();
  if (!tenant) notFound();
  const t = await getT();
  const info = await describeAckToken(tenant.id, token);
  if (!info) notFound();
  const status = info.escalation?.status ?? "none";
  const pending = status === "pending";
  void q;
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 20,
        background: "var(--canvas)",
      }}
    >
      <div
        style={{
          width: 420,
          maxWidth: "100%",
          background: "var(--panel)",
          border: "1px solid var(--line)",
          borderRadius: 18,
          boxShadow: "var(--shadow-login)",
          padding: 24,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div style={{ fontFamily: "var(--font-title)", fontSize: 16, fontWeight: 600 }}>
          Open<span style={{ color: "var(--brand)" }}>*</span>Incident
        </div>
        <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
          {t("ack.hello", { name: info.member?.name ?? "" })}
        </div>
        <div style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.35 }}>{info.title}</div>
        {pending ? (
          <form action={acknowledge} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <input type="hidden" name="token" value={token} />
            <button
              type="submit"
              data-testid="ack-button"
              style={{
                height: 48,
                borderRadius: 12,
                background: "var(--dang)",
                color: "#fff",
                border: 0,
                fontSize: 15,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              {t("ack.button")}
            </button>
            <div style={{ fontSize: 12, color: "var(--ink-3)" }}>{t("ack.note")}</div>
          </form>
        ) : (
          <div
            data-testid="ack-done"
            style={{
              border: "1px solid var(--ok)",
              background: "var(--ok-t)",
              borderRadius: 12,
              padding: "12px 14px",
              fontSize: 13.5,
              color: "var(--ink-2)",
            }}
          >
            {status === "acked"
              ? t("ack.alreadyAcked")
              : status === "none"
                ? t("ack.nothingPending")
                : t("ack.ended", {
                    status: t(
                      `alerts.escalation.ended.${status as "resolved" | "exhausted" | "cancelled"}`,
                    ),
                  })}
          </div>
        )}
        {info.incidentNumber && (
          <a
            href={`/app/incidents/${info.incidentNumber}`}
            className="oi-link"
            style={{ fontSize: 13, fontWeight: 600 }}
          >
            {t("ack.openIncident", { number: `INC-${info.incidentNumber}` })}
          </a>
        )}
      </div>
    </main>
  );
}
