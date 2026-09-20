import Link from "next/link";
import { getT } from "@/i18n/server";
import { flamegraph, profileDiff, profileFunctions, profileKinds } from "@/lib/telemetry";
import { Flamegraph } from "./flamegraph";
import { format } from "./profile-format";
import type { MessageKey } from "@/i18n/dictionaries/en";

const CARD: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius-card)",
  boxShadow: "var(--shadow-card)",
};
const MONO: React.CSSProperties = { fontFamily: "var(--mono)", fontSize: 11.5 };

/** The windows the screen offers, in minutes. */
const WINDOWS = [15, 60, 360, 1440] as const;

/**
 * Profiles: a flamegraph, the functions behind it, and the difference between
 * two windows.
 *
 * The diff is the part worth having. A flamegraph on its own answers "where is
 * the time going", which a person can usually guess; the diff answers "what
 * changed", which nobody can. It compares **shares** rather than absolute
 * values, because two windows never carry the same load and reading twice the
 * traffic as a regression is the commonest mistake made with these.
 */
export async function ProfilesTab({
  tenantId,
  service,
  type,
  sinceMinutes = 60,
  compare,
}: {
  tenantId: string;
  service?: string;
  type?: string;
  sinceMinutes?: number;
  /** Set to compare this window against the one before it. */
  compare?: boolean;
}) {
  const t = await getT();
  const kinds = await profileKinds(tenantId, 24);

  if (kinds.length === 0) {
    return (
      <div
        style={{
          ...CARD,
          padding: "28px 20px",
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <span style={{ fontSize: 13.5, fontWeight: 600 }}>{t("profiles.emptyTitle")}</span>
        <span
          style={{
            fontSize: 12.5,
            color: "var(--ink-2)",
            lineHeight: 1.6,
            maxWidth: 600,
            margin: "0 auto",
          }}
        >
          {t("profiles.emptyBody")}
        </span>
        <pre
          style={{
            ...MONO,
            textAlign: "left",
            background: "var(--sunk)",
            border: "1px solid var(--line)",
            borderRadius: 8,
            padding: "10px 12px",
            margin: "6px auto 0",
            maxWidth: 620,
            overflowX: "auto",
          }}
        >
          {"go tool pprof -proto http://localhost:6060/debug/pprof/profile?seconds=30 > cpu.pprof\n" +
            "curl -X POST '<endpoint>/v1/profiles?service=checkout-api' \\\n" +
            "  -H 'x-oi-key: <your key>' --data-binary @cpu.pprof"}
        </pre>
      </div>
    );
  }

  const chosenService = service ?? kinds[0]!.service_name;
  const forService = kinds.filter((k) => k.service_name === chosenService);
  const chosenType =
    type && forService.some((k) => k.profile_type === type) ? type : forService[0]!.profile_type;

  const to = new Date();
  const from = new Date(to.getTime() - sinceMinutes * 60_000);
  const window = { service: chosenService, type: chosenType, from, to };

  const [graph, functions] = await Promise.all([
    flamegraph(tenantId, window),
    profileFunctions(tenantId, window, 60),
  ]);

  const link = (over: Record<string, string>) => {
    const p = new URLSearchParams({
      tab: "profiles",
      service: chosenService,
      type: chosenType,
      since: String(sinceMinutes),
      ...(compare ? { compare: "1" } : {}),
      ...over,
    });
    return `/app/telemetry?${p.toString()}`;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Picker
          label={t("profiles.service")}
          options={[...new Set(kinds.map((k) => k.service_name))].map((s) => ({
            value: s,
            href: link({ service: s, type: "" }),
            current: s === chosenService,
          }))}
        />
        <Picker
          label={t("profiles.type")}
          options={forService.map((k) => ({
            value: t(`profiles.kind.${k.profile_type}` as MessageKey),
            href: link({ type: k.profile_type }),
            current: k.profile_type === chosenType,
          }))}
        />
        <Picker
          label={t("profiles.window")}
          options={WINDOWS.map((w) => ({
            value: w >= 60 ? `${w / 60} h` : `${w} min`,
            href: link({ since: String(w) }),
            current: w === sinceMinutes,
          }))}
        />
        <span style={{ flex: 1 }} />
        <Link
          href={link(compare ? { compare: "" } : { compare: "1" })}
          data-testid="profile-compare"
          style={{
            fontSize: 12,
            padding: "5px 11px",
            borderRadius: 8,
            border: "1px solid var(--line)",
            background: compare ? "var(--brand-t)" : "transparent",
            color: compare ? "var(--brand)" : "var(--ink-2)",
            textDecoration: "none",
            fontWeight: compare ? 600 : 400,
          }}
        >
          {t("profiles.compare")}
        </Link>
      </div>

      {graph.total === 0 ? (
        <div style={{ ...CARD, padding: "24px 18px", textAlign: "center", color: "var(--ink-3)" }}>
          {t("profiles.noneInWindow")}
        </div>
      ) : (
        <>
          <div style={{ ...CARD, padding: "14px 16px" }}>
            <Flamegraph root={graph.root} unit={graph.unit} total={graph.total} />
            {graph.pruned > 0 && (
              <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 8 }}>
                {t("profiles.pruned", {
                  pct: ((graph.pruned / graph.total) * 100).toFixed(1),
                  stacks: graph.stacks,
                })}
              </div>
            )}
          </div>

          {compare ? (
            <Diff tenantId={tenantId} window={window} sinceMinutes={sinceMinutes} />
          ) : (
            <div style={{ ...CARD, overflow: "hidden" }} data-testid="profile-functions">
              <Header
                left={t("profiles.function")}
                mid={t("profiles.self")}
                right={t("profiles.total")}
              />
              {functions.rows.map((row) => (
                <div
                  key={row.name}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0,1fr) 110px 110px",
                    gap: 10,
                    padding: "6px 14px",
                    borderTop: "1px solid var(--line-2)",
                    fontSize: 12,
                    alignItems: "center",
                  }}
                >
                  <span style={{ ...MONO, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {row.name}
                    {row.at && <span style={{ color: "var(--ink-3)" }}> {row.at}</span>}
                  </span>
                  <Bar
                    share={row.self / Math.max(1, functions.total)}
                    text={format(row.self, functions.unit)}
                  />
                  <Bar
                    share={row.total / Math.max(1, functions.total)}
                    text={format(row.total, functions.unit)}
                    muted
                  />
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

async function Diff({
  tenantId,
  window,
  sinceMinutes,
}: {
  tenantId: string;
  window: { service: string; type: string; from: Date; to: Date };
  sinceMinutes: number;
}) {
  const t = await getT();
  // The window immediately before this one. Not "yesterday" and not "the last
  // release": those are both good questions and both need somebody to say
  // which, where this one needs nothing and answers "did it just change".
  const before = {
    ...window,
    from: new Date(window.from.getTime() - sinceMinutes * 60_000),
    to: window.from,
  };
  const diff = await profileDiff(tenantId, before, window);

  if (diff.beforeTotal === 0) {
    return (
      <div style={{ ...CARD, padding: "20px 18px", textAlign: "center", color: "var(--ink-3)" }}>
        {t("profiles.noBefore")}
      </div>
    );
  }

  return (
    <div style={{ ...CARD, overflow: "hidden" }} data-testid="profile-diff">
      <Header
        left={t("profiles.function")}
        mid={t("profiles.totalChange")}
        right={t("profiles.selfChange")}
      />
      {diff.rows.map((row) => (
        <div
          key={row.name}
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0,1fr) 150px 150px",
            gap: 10,
            padding: "6px 14px",
            borderTop: "1px solid var(--line-2)",
            fontSize: 12,
            alignItems: "center",
          }}
        >
          <span style={{ ...MONO, overflow: "hidden", textOverflow: "ellipsis" }}>{row.name}</span>
          <Delta
            share={row.totalShare}
            after={row.afterTotal}
            before={row.beforeTotal}
            unit={diff.unit}
          />
          <Delta
            share={row.selfShare}
            after={row.afterSelf}
            before={row.beforeSelf}
            unit={diff.unit}
          />
        </div>
      ))}
      <div
        style={{
          padding: "9px 14px",
          borderTop: "1px solid var(--line)",
          fontSize: 11,
          color: "var(--ink-3)",
          lineHeight: 1.5,
        }}
      >
        {t("profiles.diffHint")}
      </div>
    </div>
  );
}

/**
 * One change, as a share and as the two values behind it.
 *
 * The share is what the row is read on and the values are what makes it
 * believable: "+60 points" with no numbers beside it is a claim, and the same
 * line with "4.4 s ← 30 ms" is a fact.
 */
function Delta({
  share,
  after,
  before,
  unit,
}: {
  share: number;
  after: number;
  before: number;
  unit: string;
}) {
  if (share === 0) {
    return <span style={{ ...MONO, color: "var(--ink-3)" }}>—</span>;
  }
  const worse = share > 0;
  return (
    <span style={{ display: "flex", flexDirection: "column" }}>
      <span style={{ color: worse ? "var(--dang)" : "var(--ok)", fontWeight: 600, ...MONO }}>
        {worse ? "+" : "−"}
        {Math.abs(share * 100).toFixed(2)} pt
      </span>
      <span style={{ ...MONO, fontSize: 10.5, color: "var(--ink-3)" }}>
        {format(after, unit)} ← {format(before, unit)}
      </span>
    </span>
  );
}

function Header({ left, mid, right }: { left: string; mid: string; right: string }) {
  const style: React.CSSProperties = {
    fontSize: 10.5,
    fontWeight: 700,
    letterSpacing: ".06em",
    color: "var(--ink-3)",
  };
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0,1fr) 150px 150px",
        gap: 10,
        padding: "9px 14px",
        borderBottom: "1px solid var(--line)",
      }}
    >
      <span style={style}>{left}</span>
      <span style={style}>{mid}</span>
      <span style={style}>{right}</span>
    </div>
  );
}

function Bar({ share, text, muted }: { share: number; text: string; muted?: boolean }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span
        style={{
          flex: 1,
          height: 5,
          borderRadius: 3,
          background: "var(--sunk)",
          overflow: "hidden",
        }}
      >
        <span
          style={{
            display: "block",
            height: "100%",
            width: `${Math.min(100, share * 100)}%`,
            background: muted ? "var(--line)" : "var(--brand)",
          }}
        />
      </span>
      <span style={{ ...MONO, fontSize: 10.5, color: "var(--ink-3)", minWidth: 52 }}>{text}</span>
    </span>
  );
}

function Picker({
  label,
  options,
}: {
  label: string;
  options: Array<{ value: string; href: string; current: boolean }>;
}) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--ink-3)" }}>{label}</span>
      {options.map((o) => (
        <Link
          key={o.href + o.value}
          href={o.href}
          style={{
            fontSize: 12,
            padding: "4px 9px",
            borderRadius: 7,
            border: "1px solid var(--line)",
            background: o.current ? "var(--panel)" : "transparent",
            color: o.current ? "var(--ink)" : "var(--ink-3)",
            fontWeight: o.current ? 600 : 400,
            textDecoration: "none",
          }}
        >
          {o.value}
        </Link>
      ))}
    </span>
  );
}
