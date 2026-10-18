import type { ReactNode } from "react";
import { getT } from "@/i18n/server";
import { atlasAvailable, loadRun } from "./data";
import { gainAtNextLevel, isUndone, namedSteps } from "./run";
import { levelKey } from "./ui";
import { actionTitle, approverOf, fixName } from "./words";

/**
 * Post-mortem section "What Atlas did", written from the journal: when it
 * started and at which level, what it wrote and changed and who approved it,
 * the grade, the cost, what was undone, and what one more level would have
 * gained on this very run. Nothing when Atlas did not act on the incident.
 * `aside` sits at the right of the heading (the host's "+ Comment").
 * Owner: atlas-ui.
 */
export async function WhatAtlasDid({
  tenantId,
  incidentId,
  aside,
}: {
  tenantId: string;
  incidentId: string;
  aside?: ReactNode;
}) {
  if (!(await atlasAvailable())) return null;
  const run = await loadRun(tenantId, incidentId);
  if (!run.inv || run.actions.length === 0) return null;
  const t = await getT();
  const inv = run.inv;
  const first = run.actions[0]!;
  const time = (d: Date) => t.fmt.time(d, t.timeZone);
  const level = inv.levelAtStart;
  const sentences: string[] = [];
  sentences.push(
    run.autonomy && level != null
      ? t("atlas.ui.wad.start", {
          time: time(first.at),
          service: run.autonomy.key,
          level,
          name: t(`atlas.ui.level.${levelKey(level)}`),
        })
      : t("atlas.ui.wad.startNoService", { time: time(first.at) }),
  );
  const steps = namedSteps(run.actions);
  if (steps.length) {
    const list = steps.map((a) => {
      const approver = approverOf(run.actions, a, run.names);
      const title = actionTitle(t, a);
      if (approver) return t("atlas.ui.wad.approved", { title, time: time(a.at), name: approver });
      if (a.autonomous) return t("atlas.ui.wad.alone", { title, time: time(a.at) });
      return t("atlas.ui.wad.step", { title, time: time(a.at) });
    });
    sentences.push(t("atlas.ui.wad.steps", { count: steps.length, list: list.join("; ") }));
  }
  const undone = run.actions.filter(isUndone).length;
  sentences.push(
    [
      inv.grade
        ? t("atlas.ui.wad.graded", { grade: t(`ai.investigation.grade.${inv.grade}`) })
        : t("atlas.ui.wad.notGraded"),
      t("atlas.ui.eur", { amount: t.fmt.amount(inv.costEur) }),
      undone ? t("atlas.ui.wad.undone", { count: undone }) : t("atlas.ui.wad.undoneNone"),
    ].join(" · ") + ".",
  );
  const gain = gainAtNextLevel(run.actions, level);
  if (gain)
    sentences.push(
      t("atlas.ui.wad.gain", {
        level: 3,
        title: fixName(gain.action),
        minutes:
          gain.minutes < 60
            ? t("atlas.ui.minutes", { count: gain.minutes })
            : t.fmt.duration(gain.minutes),
      }),
    );

  return (
    <div
      data-testid="what-atlas-did"
      style={{ display: "flex", flexDirection: "column", gap: 8, position: "relative" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, letterSpacing: "-.01em" }}>
          {t("atlas.ui.wad.title")}
        </h3>
        <span style={{ flex: 1 }} />
        {aside}
      </div>
      <p
        style={{
          margin: 0,
          fontSize: 15,
          lineHeight: 1.7,
          color: "var(--ink)",
          textWrap: "pretty",
        }}
      >
        {sentences.join(" ")}
      </p>
    </div>
  );
}
