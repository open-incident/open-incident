import Link from "next/link";
import { getT } from "@/i18n/server";
import { NavIcon } from "@/components/shell/nav-icons";
import { SOURCE_KINDS } from "@/lib/alert-sources";
import { IntegrationIcon } from "@/app/app/settings/integrations/icons";

/**
 * The three steps, while the workspace has never been paged.
 *
 * They are the home screen rather than a settings page, because a workspace
 * that has never rung a phone has nothing else worth showing. Each one is done
 * here or one click away, and the third really calls: the only proof the chain
 * works is feeling it ring.
 */
export async function SetupSteps({
  memberName,
  workspaceName,
  steps,
  sourceCount,
  monitorCount,
}: {
  memberName: string;
  workspaceName: string;
  steps: { pager: boolean; source: boolean; firstAlert: boolean; verified: boolean };
  sourceCount: number;
  monitorCount: number;
}) {
  const t = await getT();

  const done = [steps.pager, steps.source || monitorCount > 0, steps.verified];
  const doneN = done.filter(Boolean).length;
  const openIndex = done.findIndex((d) => !d);

  const ETA = ["4 min", "3 min", "1 min", "0 min"];

  return (
    <div
      className="oi-rise"
      style={{
        maxWidth: 800,
        margin: "28px auto 0",
        padding: "0 28px 60px",
        display: "flex",
        flexDirection: "column",
        gap: 22,
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0,1fr) 250px",
          gap: 24,
          alignItems: "end",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: ".1em",
              textTransform: "uppercase",
              color: "var(--brand-2)",
            }}
          >
            {t("home.welcome", { name: memberName, workspace: workspaceName })}
          </div>
          <h1
            style={{
              margin: 0,
              fontFamily: "var(--title)",
              fontSize: 32,
              fontWeight: 600,
              letterSpacing: "-.02em",
              lineHeight: 1.1,
            }}
          >
            {t("home.setupTitle")}
          </h1>
          <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.6, color: "var(--ink-2)" }}>
            {t("home.setupLead")}
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span
              style={{
                fontFamily: "var(--title)",
                fontSize: 26,
                fontWeight: 600,
                color: "var(--brand)",
                letterSpacing: "-.02em",
              }}
            >
              {Math.round((doneN / 3) * 100)} %
            </span>
            <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
              {t("home.setupProgress", { done: doneN, eta: ETA[doneN] ?? "0 min" })}
            </span>
          </div>
          <div
            style={{
              height: 6,
              borderRadius: 999,
              background: "var(--sunk)",
              overflow: "hidden",
              display: "flex",
              gap: 2,
            }}
          >
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                style={{
                  flex: 1,
                  borderRadius: 999,
                  background:
                    i < doneN ? "var(--ok)" : i === doneN ? "var(--brand-b)" : "var(--line)",
                }}
              />
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Step
          n={1}
          done={done[0]!}
          open={openIndex === 0}
          title={t("home.step1")}
          minutes="~1 min"
          description={t("home.step1Body")}
          doneLabel={t("home.step1Done")}
        >
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
            {[
              { href: "/app/on-call?tab=notif", t: t("home.whoMe"), d: t("home.whoMeBody") },
              { href: "/app/settings/members", t: t("home.whoMate"), d: t("home.whoMateBody") },
              { href: "/app/on-call?tab=sched", t: t("home.whoSched"), d: t("home.whoSchedBody") },
            ].map((o, i) => (
              <Link
                key={o.href}
                href={o.href}
                className="oi-hover-edge"
                style={{
                  border: i === 0 ? "1.5px solid var(--brand)" : "1px solid var(--line)",
                  borderRadius: 12,
                  padding: "13px 14px",
                  background: i === 0 ? "var(--brand-t)" : "var(--panel)",
                  textDecoration: "none",
                  color: "inherit",
                }}
              >
                <div style={{ fontSize: 13.5, fontWeight: 600 }}>{o.t}</div>
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--ink-3)",
                    marginTop: 3,
                    lineHeight: 1.45,
                  }}
                >
                  {o.d}
                </div>
              </Link>
            ))}
          </div>
        </Step>

        <Step
          n={2}
          done={done[1]!}
          open={openIndex === 1}
          title={t("home.step2")}
          minutes="~2 min"
          description={t("home.step2Body")}
          doneLabel={t("home.step2Done", { count: sourceCount + monitorCount })}
        >
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div
              style={{
                border: "1px solid var(--line)",
                borderRadius: 12,
                padding: "13px 14px",
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>{t("home.aToolSends")}</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
                {SOURCE_KINDS.map((k) => (
                  <Link
                    key={k.kind}
                    href={`/app/alerts?new=${k.kind}`}
                    className="oi-hover-edge"
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 5,
                      padding: "9px 4px",
                      border: "1px solid var(--line)",
                      borderRadius: 10,
                      background: "var(--panel)",
                      textDecoration: "none",
                      color: "inherit",
                    }}
                  >
                    <span
                      style={{
                        width: 22,
                        height: 22,
                        display: "grid",
                        placeItems: "center",
                        color: "var(--ink)",
                      }}
                    >
                      <IntegrationIcon id={k.icon} />
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        textAlign: "center",
                        lineHeight: 1.2,
                      }}
                    >
                      {k.label}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
            <Link
              href="/app/monitors?new=1"
              className="oi-hover-edge"
              style={{
                border: "1px solid var(--line)",
                borderRadius: 12,
                padding: "13px 14px",
                display: "flex",
                flexDirection: "column",
                gap: 10,
                background: "var(--panel)",
                textDecoration: "none",
                color: "inherit",
              }}
            >
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>{t("home.weWatchUrl")}</div>
              <div
                style={{
                  height: 36,
                  border: "1px solid var(--line)",
                  borderRadius: 9,
                  display: "flex",
                  alignItems: "center",
                  padding: "0 11px",
                  fontSize: 13,
                  fontFamily: "var(--mono)",
                  color: "var(--ink-3)",
                }}
              >
                https://
              </div>
              <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.5 }}>
                {t("home.weWatchUrlBody")}
              </div>
            </Link>
          </div>
        </Step>

        <Step
          n={3}
          done={done[2]!}
          open={openIndex === 2}
          title={t("home.step3")}
          minutes="~1 min"
          description={t("home.step3Body")}
          doneLabel={t("home.step3Done")}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.55 }}>
              {t("home.step3Explain")}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 13,
                  color: "var(--ink-2)",
                }}
              >
                <span style={{ width: 16, height: 16, display: "grid", placeItems: "center" }}>
                  <NavIcon id="onCall" size={16} />
                </span>
                {t("home.step3Where")}
              </span>
            </div>
          </div>
        </Step>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
        {[
          { k: t("home.youWillHave"), v: t("home.youWillHaveBody") },
          { k: t("home.youDontNeed"), v: t("home.youDontNeedBody") },
        ].map((c) => (
          <div
            key={c.k}
            style={{
              background: "var(--panel)",
              border: "1px solid var(--line)",
              borderRadius: 12,
              padding: "12px 14px",
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: ".08em",
                color: "var(--ink-3)",
              }}
            >
              {c.k}
            </span>
            <span style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--ink-2)" }}>{c.v}</span>
          </div>
        ))}
        <Link
          href="/app/incidents"
          className="oi-hover-edge"
          style={{
            background: "var(--panel)",
            border: "1px dashed var(--line)",
            borderRadius: 12,
            padding: "12px 14px",
            display: "flex",
            flexDirection: "column",
            gap: 4,
            textDecoration: "none",
          }}
        >
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: ".08em",
              color: "var(--ink-3)",
            }}
          >
            {t("home.alreadySetUp")}
          </span>
          <span style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--brand)", fontWeight: 600 }}>
            {t("home.skip")}
          </span>
        </Link>
      </div>

      <div style={{ fontSize: 12, color: "var(--ink-3)", textAlign: "center" }}>
        {t("home.stepsDisappear")}
      </div>
    </div>
  );
}

function Step({
  n,
  done,
  open,
  title,
  minutes,
  description,
  doneLabel,
  children,
}: {
  n: number;
  done: boolean;
  open: boolean;
  title: string;
  minutes: string;
  description: string;
  doneLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: "var(--panel)",
        border: open ? "1.5px solid var(--brand)" : "1px solid var(--line)",
        borderRadius: "var(--radius-card)",
        boxShadow: open ? "var(--shadow-card-hover)" : "var(--shadow-card)",
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 20px" }}>
        <span
          style={{
            width: 30,
            height: 30,
            borderRadius: "50%",
            background: done ? "var(--ok)" : open ? "var(--brand)" : "var(--sunk)",
            color: done || open ? "var(--on-brand)" : "var(--ink-3)",
            display: "grid",
            placeItems: "center",
            fontSize: 13,
            fontWeight: 700,
            flex: "none",
          }}
        >
          {done ? "✓" : n}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <span style={{ fontSize: 15, fontWeight: 600, whiteSpace: "nowrap" }}>{title}</span>
            <span
              style={{
                fontSize: 11,
                color: "var(--ink-3)",
                border: "1px solid var(--line)",
                borderRadius: 5,
                padding: "0 6px",
                whiteSpace: "nowrap",
                flex: "none",
              }}
            >
              {minutes}
            </span>
          </div>
          <div style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 2 }}>{description}</div>
        </div>
        {done && (
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              fontWeight: 600,
              color: "var(--ok)",
              background: "var(--ok-t)",
              borderRadius: 999,
              padding: "3px 10px",
              maxWidth: 260,
              flex: "none",
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "var(--ok)",
                flex: "none",
              }}
            />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {doneLabel}
            </span>
          </span>
        )}
      </div>
      {open && (
        <div
          className="oi-rise-fast"
          style={{
            borderTop: "1px solid var(--line-2)",
            padding: "18px 20px 20px",
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
