import { eq } from "drizzle-orm";
import { incidentChannels, incidents, withTenant } from "@openincident/db";
import { getSlackInstall, getTeamsInstall } from "@openincident/chat";
import { getT } from "@/i18n/server";
import { requireMember } from "@/lib/session";
import { createIncidentChannel } from "./chat-actions";

/** The side panel's chat section: the Slack and Teams channels (or the button that creates them) and the war-room link. */
export async function IncidentChat({
  incidentId,
  number,
  canAct,
}: {
  incidentId: string;
  number: number;
  canAct: boolean;
}) {
  const { tenant } = await requireMember();
  const t = await getT();
  const data = await withTenant(tenant.id, async (tx) => {
    const channels = await tx
      .select()
      .from(incidentChannels)
      .where(eq(incidentChannels.incidentId, incidentId));
    const channel = channels.find((c) => c.kind === "slack");
    const teamsChannel = channels.find((c) => c.kind === "teams");
    const [inc] = await tx
      .select({ bridgeUrl: incidents.bridgeUrl, phase: incidents.phase })
      .from(incidents)
      .where(eq(incidents.id, incidentId));
    const install = await getSlackInstall(tx, tenant.id);
    const teamsInstall = await getTeamsInstall(tx, tenant.id);
    return {
      channel: channel ?? null,
      teamsChannel: teamsChannel ?? null,
      bridgeUrl: inc?.bridgeUrl ?? null,
      phase: inc?.phase,
      install,
      teamsInstall,
    };
  });
  if (!data.channel && !data.teamsChannel && !data.install && !data.teamsInstall && !data.bridgeUrl)
    return null;
  const missingChannel =
    (data.install && !data.channel) || (data.teamsInstall && !data.teamsChannel);
  return (
    <>
      <div style={{ height: 1, background: "var(--line-2)" }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div className="oi-eyebrow">{t("incident.chat")}</div>
        {data.channel ? (
          <a
            data-testid="slack-channel"
            href={`https://slack.com/app_redirect?channel=${data.channel.channelId}${data.install ? `&team=${data.install.teamId}` : ""}`}
            target="_blank"
            rel="noreferrer"
            className="oi-hover-edge"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              border: "1px solid var(--line)",
              borderRadius: 10,
              padding: "8px 10px",
              fontSize: 12.5,
              color: "inherit",
              textDecoration: "none",
            }}
          >
            <span
              style={{
                width: 22,
                height: 22,
                borderRadius: 6,
                background: "var(--sunk)",
                display: "grid",
                placeItems: "center",
                fontSize: 9.5,
                fontWeight: 700,
              }}
            >
              SL
            </span>
            <span
              style={{ flex: 1, fontWeight: 600, fontFamily: "var(--font-mono)", fontSize: 12 }}
            >
              #{data.channel.channelName}
            </span>
            <span style={{ fontSize: 11, color: "var(--ink-3)" }}>{t("incident.openInSlack")}</span>
          </a>
        ) : null}
        {data.teamsChannel && (
          <a
            data-testid="teams-channel"
            href={data.teamsChannel.meta.webUrl ?? "#"}
            target="_blank"
            rel="noreferrer"
            className="oi-hover-edge"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              border: "1px solid var(--line)",
              borderRadius: 10,
              padding: "8px 10px",
              fontSize: 12.5,
              color: "inherit",
              textDecoration: "none",
            }}
          >
            <span
              style={{
                width: 22,
                height: 22,
                borderRadius: 6,
                background: "var(--sunk)",
                display: "grid",
                placeItems: "center",
                fontSize: 9.5,
                fontWeight: 700,
              }}
            >
              MT
            </span>
            <span
              style={{ flex: 1, fontWeight: 600, fontFamily: "var(--font-mono)", fontSize: 12 }}
            >
              {data.teamsChannel.channelName}
            </span>
            <span style={{ fontSize: 11, color: "var(--ink-3)" }}>{t("incident.openInTeams")}</span>
          </a>
        )}
        {missingChannel && canAct && data.phase !== "closed" ? (
          <form action={createIncidentChannel}>
            <input type="hidden" name="number" value={number} />
            <button
              type="submit"
              data-testid="slack-create-channel"
              className="oi-hover-edge-fill"
              style={{
                width: "100%",
                height: 32,
                border: "1px solid var(--line)",
                borderRadius: 9,
                background: "var(--panel)",
                fontSize: 12.5,
                fontWeight: 600,
                color: "var(--brand)",
                cursor: "pointer",
              }}
            >
              {t("incident.createChatChannel")}
            </button>
          </form>
        ) : missingChannel ? (
          <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{t("incident.noChatChannel")}</div>
        ) : null}
        {data.bridgeUrl && (
          <a
            data-testid="bridge-link"
            href={data.bridgeUrl}
            target="_blank"
            rel="noreferrer"
            className="oi-hover-edge"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              border: "1px solid var(--line)",
              borderRadius: 10,
              padding: "8px 10px",
              fontSize: 12.5,
              color: "inherit",
              textDecoration: "none",
            }}
          >
            <span
              style={{
                width: 22,
                height: 22,
                borderRadius: 6,
                background: "var(--ok-t)",
                color: "var(--ok)",
                display: "grid",
                placeItems: "center",
                fontSize: 11,
              }}
            >
              ▶
            </span>
            <span style={{ flex: 1, fontWeight: 600 }}>{t("incident.joinBridge")}</span>
            <span style={{ fontSize: 11, color: "var(--ink-3)", fontFamily: "var(--font-mono)" }}>
              {new URL(data.bridgeUrl).host}
            </span>
          </a>
        )}
      </div>
    </>
  );
}
