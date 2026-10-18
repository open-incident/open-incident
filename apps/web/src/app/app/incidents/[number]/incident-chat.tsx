import Link from "next/link";
import { and, eq, sql } from "drizzle-orm";
import { incidentChannels, incidentEvents, incidents, withTenant } from "@openincident/db";
import { getSlackInstall, getTeamsInstall, slackCall } from "@openincident/chat";
import { getT } from "@/i18n/server";
import { requireMember } from "@/lib/session";
import { createIncidentChannel } from "./chat-actions";
import { card, eyebrow } from "./side-panel";

/** What Slack says of the channel right now — asked live, never stored, and skipped when slow. */
async function slackChannelFacts(
  token: string,
  channelId: string,
): Promise<{ members: number | null; messages: number | null; more: boolean; archived: boolean }> {
  const within = <T,>(p: Promise<T>, fallback: T) =>
    Promise.race([p, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), 1500))]);
  const [info, history] = await Promise.all([
    within(
      slackCall<{ channel: { num_members?: number; is_archived?: boolean } }>(
        token,
        "conversations.info",
        { channel: channelId, include_num_members: true },
        true,
      ),
      null,
    ),
    within(
      slackCall<{ messages: unknown[]; has_more?: boolean }>(
        token,
        "conversations.history",
        { channel: channelId, limit: 200 },
        true,
      ),
      null,
    ),
  ]);
  return {
    members: info?.ok ? (info.channel.num_members ?? null) : null,
    archived: info?.ok ? Boolean(info.channel.is_archived) : false,
    messages: history?.ok ? history.messages.length : null,
    more: history?.ok ? Boolean(history.has_more) : false,
  };
}

/**
 * CHANNELS — where the incident is also run: its Slack channel and its Teams
 * channel, each with the button that opens it, then one line on the state of
 * the conversation (the pinned header kept current, the messages, the ones
 * pinned to the timeline with 📌). Everything comes from what the chat
 * integrations stored, plus what Slack answers about the channel; a figure
 * nobody can know is left out rather than guessed. With no chat connected
 * the card says so and points at Settings › Slack & Teams.
 */
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
    const [inc] = await tx
      .select({ bridgeUrl: incidents.bridgeUrl, phase: incidents.phase })
      .from(incidents)
      .where(eq(incidents.id, incidentId));
    const [pins] = await tx
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(incidentEvents)
      .where(
        and(
          eq(incidentEvents.incidentId, incidentId),
          eq(incidentEvents.kind, "note"),
          sql`${incidentEvents.payload}->>'system' = 'chat_pin'`,
        ),
      );
    return {
      slack: channels.find((c) => c.kind === "slack") ?? null,
      teams: channels.find((c) => c.kind === "teams") ?? null,
      bridgeUrl: inc?.bridgeUrl ?? null,
      phase: inc?.phase,
      install: await getSlackInstall(tx, tenant.id),
      teamsInstall: await getTeamsInstall(tx, tenant.id),
      pinned: pins?.n ?? 0,
    };
  });
  const facts =
    data.slack && data.install
      ? await slackChannelFacts(data.install.token, data.slack.channelId)
      : null;
  const connected = Boolean(data.install || data.teamsInstall);
  const missing = (data.install && !data.slack) || (data.teamsInstall && !data.teams);
  const headerCurrent = Boolean(data.slack?.headerTs || data.teams?.headerTs);

  const rows: Array<{
    testid: string;
    glyph: string;
    name: string;
    sub: string;
    href: string | null;
    open: string;
  }> = [];
  if (data.slack)
    rows.push({
      testid: "slack-channel",
      glyph: "Sl",
      name: `#${data.slack.channelName}`,
      sub: [
        "Slack",
        facts?.members !== null && facts?.members !== undefined
          ? t("incv2.ch.members", { count: facts.members })
          : (data.install?.teamName ?? ""),
        facts?.archived ? t("incv2.ch.archived") : "",
      ]
        .filter(Boolean)
        .join(" · "),
      href: `https://slack.com/app_redirect?channel=${data.slack.channelId}${data.install ? `&team=${data.install.teamId}` : ""}`,
      open: t("incident.openInSlack"),
    });
  if (data.teams)
    rows.push({
      testid: "teams-channel",
      glyph: "Te",
      name: data.teams.channelName,
      sub: data.teamsInstall ? `Teams › ${data.teamsInstall.teamName}` : "Teams",
      href: data.teams.meta.webUrl ?? null,
      open: t("incident.openInTeams"),
    });

  const line = [
    headerCurrent ? t("incv2.ch.headerCurrent") : "",
    facts?.messages !== null && facts?.messages !== undefined
      ? t(facts.more ? "incv2.ch.messagesMore" : "incv2.ch.messages", { count: facts.messages })
      : "",
    data.slack || data.teams ? t("incv2.ch.pinned", { count: data.pinned }) : "",
  ].filter(Boolean);

  return (
    <div style={{ ...card, gap: 9 }} data-testid="incident-channels">
      <div style={{ display: "flex", alignItems: "center" }}>
        <span style={eyebrow}>{t("incv2.ch.title")}</span>
        <span style={{ flex: 1 }} />
        <Link
          href="/app/settings/chat"
          className="oi-link"
          style={{ fontSize: 11.5, fontWeight: 600, color: "var(--brand)" }}
        >
          {t("incv2.ch.settings")}
        </Link>
      </div>
      {rows.map((r) => (
        <div
          key={r.testid}
          data-testid={r.testid}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            border: "1px solid var(--line-2)",
            borderRadius: 11,
            padding: "9px 11px",
          }}
        >
          <span
            aria-hidden
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              background: "var(--topbar-dark)",
              color: "#fff",
              display: "grid",
              placeItems: "center",
              fontSize: 10.5,
              fontWeight: 700,
              flex: "none",
            }}
          >
            {r.glyph}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontFamily: "var(--mono)",
                fontSize: 12.5,
                fontWeight: 600,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {r.name}
            </div>
            <div
              style={{
                fontSize: 11,
                color: "var(--ink-3)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {r.sub}
            </div>
          </div>
          {r.href && (
            <a
              href={r.href}
              target="_blank"
              rel="noreferrer"
              className="oi-hover"
              style={{
                height: 26,
                padding: "0 10px",
                border: "1px solid var(--line)",
                borderRadius: 7,
                display: "flex",
                alignItems: "center",
                fontSize: 11.5,
                fontWeight: 600,
                whiteSpace: "nowrap",
                color: "inherit",
                textDecoration: "none",
                flex: "none",
              }}
            >
              {r.open}
            </a>
          )}
        </div>
      ))}
      {data.bridgeUrl && (
        <div
          data-testid="bridge-link"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            border: "1px solid var(--line-2)",
            borderRadius: 11,
            padding: "9px 11px",
          }}
        >
          <span
            aria-hidden
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              background: "var(--ok-t)",
              color: "var(--ok)",
              display: "grid",
              placeItems: "center",
              fontSize: 11,
              flex: "none",
            }}
          >
            ▶
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600 }}>{t("incident.joinBridge")}</div>
            <div
              style={{
                fontSize: 11,
                color: "var(--ink-3)",
                fontFamily: "var(--mono)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {new URL(data.bridgeUrl).host}
            </div>
          </div>
          <a
            href={data.bridgeUrl}
            target="_blank"
            rel="noreferrer"
            className="oi-hover"
            style={{
              height: 26,
              padding: "0 10px",
              border: "1px solid var(--line)",
              borderRadius: 7,
              display: "flex",
              alignItems: "center",
              fontSize: 11.5,
              fontWeight: 600,
              whiteSpace: "nowrap",
              color: "inherit",
              textDecoration: "none",
              flex: "none",
            }}
          >
            {t("incv2.ch.join")}
          </a>
        </div>
      )}
      {missing && canAct && data.phase !== "closed" ? (
        <form action={createIncidentChannel}>
          <input type="hidden" name="number" value={number} />
          <button
            type="submit"
            data-testid="slack-create-channel"
            className="oi-hover-edge-fill"
            style={{
              width: "100%",
              height: 30,
              border: "1px solid var(--line)",
              borderRadius: 8,
              background: "var(--panel)",
              fontSize: 12,
              fontWeight: 600,
              color: "var(--brand)",
              cursor: "pointer",
            }}
          >
            {t("incident.createChatChannel")}
          </button>
        </form>
      ) : missing ? (
        <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{t("incident.noChatChannel")}</div>
      ) : null}
      {!connected && rows.length === 0 && (
        <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.5 }}>
          {t("incv2.ch.none")}
        </div>
      )}
      {line.length > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            fontSize: 11.5,
            color: "var(--ink-3)",
            lineHeight: 1.45,
          }}
        >
          <span
            aria-hidden
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: headerCurrent ? "var(--ok)" : "var(--ink-3)",
              flex: "none",
            }}
          />
          {line.join(" · ")}
        </div>
      )}
    </div>
  );
}
