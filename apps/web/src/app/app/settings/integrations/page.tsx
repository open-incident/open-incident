import Link from "next/link";
import { redirect } from "next/navigation";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  alertSources,
  alerts,
  integrationInstalls,
  members,
  migrationRuns,
  migrationTeamSwitch,
  withTenant,
} from "@openincident/db";
import {
  getSlackInstall,
  getTeamsInstall,
  slackConfigured,
  teamsConfigured,
} from "@openincident/chat";
import { docsTarget, type DocsConfig } from "@openincident/docs";
import { trackerTarget, type TrackerConfig } from "@openincident/trackers";
import type { MessageKey } from "@/i18n/dictionaries/en";
import { getT } from "@/i18n/server";
import { SOURCE_KINDS } from "@/lib/alert-sources";
import { isManager, requireMember } from "@/lib/session";
import {
  FilterLinks,
  ItemLink,
  ListCard,
  ListItem,
  Note,
  SettingsPage,
  listActionStyle,
  type ChipSpec,
} from "@/components/settings/template";
import { ConnectButton, type ConnectKind } from "./connect-dialog";
import { integrationGlyph } from "./glyph";

type Category = "chat" | "code" | "docs" | "video" | "sources" | "migration";

const CATEGORIES: Category[] = ["chat", "code", "docs", "video", "sources", "migration"];

type Item = {
  id: string;
  name: string;
  category: Category;
  desc: string;
  connected: boolean;
  chips?: ChipSpec[];
  right?: string;
  button?: React.ReactNode;
};

const CONNECT_KINDS: ConnectKind[] = [
  "github",
  "gitlab",
  "jira",
  "linear",
  "confluence",
  "notion",
  "meet",
  "zoom",
];

/**
 * Settings › Integrations (design V2): the tools Open Incident posts to and
 * reads from, as two lists — what is connected, what is available — with a
 * filter by kind of tool.
 *
 * Slack and Microsoft Teams are run from their own page (Slack & Teams):
 * their rows say how they are connected and send there. Alert sources are
 * created under Alerts, and their rows send there too; the Opsgenie row
 * sends to the migration. Every other tool connects in a dialog that tests
 * the credentials before anything is stored.
 */
export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const q = await searchParams;
  // The Slack and Teams flows moved to their own page; old links land there.
  if (q.connect === "slack" || q.connect === "teams") {
    const rest = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v !== undefined) rest.set(k, v);
    redirect(`/app/settings/chat?${rest.toString()}`);
  }
  if (q.connect && SOURCE_KINDS.some((k) => k.kind === q.connect))
    redirect(`/app/alerts/sources?new=${q.connect}`);

  const { tenant, member } = await requireMember();
  const t = await getT();
  const manages = isManager(member);

  const data = await withTenant(tenant.id, async (tx) => {
    const installs = await tx
      .select({ install: integrationInstalls, by: members.name })
      .from(integrationInstalls)
      .leftJoin(members, eq(members.id, integrationInstalls.installedByMemberId))
      .where(
        and(eq(integrationInstalls.tenantId, tenant.id), eq(integrationInstalls.status, "active")),
      );
    const sources = await tx
      .select({
        kind: alertSources.kind,
        active: alertSources.active,
        count:
          sql<number>`(select count(*) from ${alerts} a where a.source_id = ${alertSources.id} and a.first_at > now() - interval '90 days')`.mapWith(
            Number,
          ),
      })
      .from(alertSources)
      .where(eq(alertSources.tenantId, tenant.id));
    const slack = await getSlackInstall(tx, tenant.id);
    const teams = await getTeamsInstall(tx, tenant.id);
    const [run] = await tx
      .select({ id: migrationRuns.id, completedAt: migrationRuns.completedAt })
      .from(migrationRuns)
      .where(eq(migrationRuns.tenantId, tenant.id))
      .orderBy(desc(migrationRuns.createdAt))
      .limit(1);
    const switches = run
      ? await tx
          .select({ state: migrationTeamSwitch.state })
          .from(migrationTeamSwitch)
          .where(
            and(eq(migrationTeamSwitch.tenantId, tenant.id), eq(migrationTeamSwitch.runId, run.id)),
          )
      : [];
    return { installs, sources, slack, teams, run: run ?? null, switches };
  });

  const install = (kind: string) => data.installs.find((i) => i.install.kind === kind);
  const connectedChip: ChipSpec = { label: t("settingsV2.int.connected"), tone: "ok" };
  const describe = (id: string) => t(`settingsV2.int.desc.${id}` as MessageKey);
  const chatButton = (
    <ItemLink href="/app/settings/chat" ink="brand">
      {t("settingsV2.int.openChat")}
    </ItemLink>
  );
  const unavailableChip: ChipSpec = { label: t("settingsV2.int.notSetUp"), tone: "mute" };

  const items: Item[] = [];

  /* ---------- Chat: run from Slack & Teams ---------- */
  {
    const s = data.slack;
    items.push({
      id: "slack",
      name: "Slack",
      category: "chat",
      desc: describe("slack"),
      connected: Boolean(s),
      chips: s ? [connectedChip] : slackConfigured() ? undefined : [unavailableChip],
      right: s
        ? [s.teamName, s.config.announceChannelName ? `#${s.config.announceChannelName}` : null]
            .filter(Boolean)
            .join(" · ")
        : undefined,
      button: chatButton,
    });
    const m = data.teams;
    items.push({
      id: "teams",
      name: "Microsoft Teams",
      category: "chat",
      desc: describe("teams"),
      connected: Boolean(m),
      chips: m
        ? [{ label: t("settingsV2.int.paired"), tone: "ok" }]
        : teamsConfigured()
          ? undefined
          : [unavailableChip],
      right: m
        ? [
            t("settingsV2.int.teamsTeam", { name: m.teamName ?? "" }),
            m.config.announceChannelName ?? null,
          ]
            .filter(Boolean)
            .join(" · ")
        : undefined,
      button: chatButton,
    });
  }

  /* ---------- Trackers, docs, video: connected in a dialog ---------- */
  const NAMES: Record<ConnectKind, string> = {
    github: "GitHub",
    gitlab: "GitLab",
    jira: "Jira",
    linear: "Linear",
    confluence: "Confluence",
    notion: "Notion",
    meet: "Google Meet",
    zoom: "Zoom",
  };
  for (const kind of CONNECT_KINDS) {
    const row = install(kind);
    const cfg = (row?.install.config ?? {}) as Record<string, unknown>;
    const values = Object.fromEntries(
      Object.entries(cfg)
        .filter(([k, v]) => k !== "kind" && typeof v === "string")
        .map(([k, v]) => [k, v as string]),
    );
    const category: Category =
      kind === "confluence" || kind === "notion"
        ? "docs"
        : kind === "meet" || kind === "zoom"
          ? "video"
          : "code";
    const target = row
      ? category === "code"
        ? trackerTarget({ ...cfg, kind } as TrackerConfig)
        : category === "docs"
          ? docsTarget({ ...cfg, kind } as DocsConfig)
          : String(cfg.template ?? "")
      : "";
    const account =
      row?.install.externalName && row.install.externalName !== target
        ? `${target} · ${row.install.externalName}`
        : target;
    items.push({
      id: kind,
      name: NAMES[kind],
      category,
      desc: describe(kind),
      connected: Boolean(row),
      chips: row ? [connectedChip] : undefined,
      right: row ? account : undefined,
      button: manages ? (
        <ConnectButton
          kind={kind}
          name={NAMES[kind]}
          connected={Boolean(row)}
          values={values}
          connectedAs={
            row
              ? row.by
                ? t("settingsV2.int.connectedAsBy", { account, name: row.by })
                : account
              : undefined
          }
          initialOpen={q.connect === kind}
        />
      ) : undefined,
    });
  }

  /* ---------- Alert sources: created under Alerts ---------- */
  for (const meta of SOURCE_KINDS) {
    const mine = data.sources.filter((s) => s.kind === meta.kind && s.active);
    const n = mine.reduce((a, s) => a + s.count, 0);
    items.push({
      id: meta.kind,
      name: meta.label,
      category: "sources",
      desc: describe(`source.${meta.kind}`),
      connected: mine.length > 0,
      chips: mine.length ? [connectedChip] : undefined,
      right: mine.length
        ? mine.length > 1
          ? t("settingsV2.int.sourcesMany", { count: mine.length, alerts: n })
          : t("settingsV2.int.sourceAlerts", { count: n })
        : undefined,
      button: mine.length ? (
        <ItemLink href="/app/alerts/sources">{t("settingsV2.int.openAlerts")}</ItemLink>
      ) : manages ? (
        <ItemLink href={`/app/alerts/sources?new=${meta.kind}`} ink="brand">
          {t("settingsV2.int.connect")}
        </ItemLink>
      ) : undefined,
    });
  }

  /* ---------- Opsgenie: the migration ---------- */
  {
    const run = data.run;
    const switched = data.switches.filter((s) => s.state === "switched").length;
    items.push({
      id: "opsgenie",
      name: "Opsgenie",
      category: "migration",
      desc: describe("opsgenie"),
      connected: Boolean(run),
      chips: run
        ? [
            run.completedAt
              ? { label: t("settingsV2.int.migrated"), tone: "ok" }
              : { label: t("settingsV2.int.migrating"), tone: "wait" },
          ]
        : undefined,
      right:
        run && data.switches.length
          ? t("settingsV2.int.teamsSwitched", { switched, count: data.switches.length })
          : undefined,
      button: (
        <ItemLink href="/app/settings/migrate" ink={run ? "ink" : "brand"}>
          {run ? t("settingsV2.int.openMigration") : t("settingsV2.int.migrate")}
        </ItemLink>
      ),
    });
  }

  const cat = CATEGORIES.includes(q.cat as Category) ? (q.cat as Category) : null;
  const visible = items.filter((i) => !cat || i.category === cat);
  const connected = visible.filter((i) => i.connected);
  const available = visible.filter((i) => !i.connected);
  const row = (i: Item) => (
    <ListItem
      key={i.id}
      testId="integration-card"
      data={{ integration: i.id }}
      glyph={{ text: integrationGlyph(i.id, i.name) }}
      title={i.name}
      sub={i.desc}
      chips={i.chips}
      right={i.right}
      button={i.button}
    />
  );

  return (
    <SettingsPage
      home={t("settingsV2.home")}
      crumb={t("settingsV2.group.platform")}
      title={t("settingsV2.entry.integrations")}
      lead={t("settingsV2.int.lead")}
      testId="settings-integrations"
    >
      <ListCard
        title={t("settingsV2.int.chatTitle")}
        hint={t("settingsV2.int.chatHint")}
        testId="integrations-chat"
        action={
          <Link href="/app/settings/chat" className="oi-hover" style={listActionStyle}>
            {t("settingsV2.int.openChat")}
          </Link>
        }
      />
      <FilterLinks
        testId="integrations-filters"
        items={[
          {
            key: "all",
            label: t("settingsV2.int.cat.all"),
            count: items.length,
            href: "/app/settings/integrations",
            active: !cat,
          },
          ...CATEGORIES.map((c) => ({
            key: c,
            label: t(`settingsV2.int.cat.${c}` as MessageKey),
            count: items.filter((i) => i.category === c).length,
            href: `/app/settings/integrations?cat=${c}`,
            active: cat === c,
          })),
        ]}
      />
      {connected.length ? (
        <ListCard title={t("settingsV2.int.connectedTitle")} testId="integrations-connected">
          {connected.map(row)}
        </ListCard>
      ) : (
        <Note>{t("settingsV2.int.noneConnected")}</Note>
      )}
      {available.length ? (
        <ListCard title={t("settingsV2.int.available")} testId="integrations-available">
          {available.map(row)}
        </ListCard>
      ) : (
        <Note>{t("settingsV2.int.allConnected")}</Note>
      )}
    </SettingsPage>
  );
}
