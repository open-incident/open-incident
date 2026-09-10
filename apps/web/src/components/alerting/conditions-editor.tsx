"use client";

import { useState } from "react";
import type { Condition, ConditionGroup, ConditionOp } from "@openincident/db";
import { useT } from "@/i18n/client";

export type SubjectOption = { key: string; label: string };

const OPS: ConditionOp[] = [
  "eq",
  "neq",
  "in",
  "not_in",
  "contains",
  "matches",
  "exists",
  "missing",
];
const NO_VALUE: ConditionOp[] = ["exists", "missing"];

const control: React.CSSProperties = {
  height: 32,
  padding: "0 9px",
  border: "1px solid var(--line)",
  borderRadius: 8,
  background: "var(--panel)",
  fontSize: 12.5,
  outline: "none",
};
const small: React.CSSProperties = {
  background: "none",
  border: 0,
  padding: "2px 6px",
  fontSize: 12,
  fontWeight: 600,
  color: "var(--brand)",
  cursor: "pointer",
};

/**
 * Conditions as people say them: "environment is production AND priority is
 * one of P1, P2" — groups ORed, lines ANDed. The value is JSON in a hidden
 * field the server action reads; the subjects are the workspace's attributes
 * plus the four built-ins.
 */
export function ConditionsEditor({
  name,
  initial,
  attributes,
  emptyLabel,
}: {
  name: string;
  initial: ConditionGroup[];
  attributes: SubjectOption[];
  emptyLabel: string;
}) {
  const t = useT();
  const [groups, setGroups] = useState<ConditionGroup[]>(initial.length ? initial : []);
  const subjects: SubjectOption[] = [
    ...attributes,
    { key: "priority", label: t("routes.subject.priority") },
    { key: "source", label: t("routes.subject.source") },
    { key: "source_name", label: t("routes.subject.sourceName") },
    { key: "title", label: t("routes.subject.title") },
  ];
  const update = (gi: number, ci: number, patch: Partial<Condition>) =>
    setGroups((gs) =>
      gs.map((g, i) =>
        i !== gi ? g : { all: g.all.map((c, j) => (j !== ci ? c : { ...c, ...patch })) },
      ),
    );
  const blank = (): Condition => ({
    attribute: subjects[0]?.key ?? "environment",
    op: "eq",
    value: "",
  });
  return (
    <div
      style={{ display: "flex", flexDirection: "column", gap: 8 }}
      data-testid={`conditions-${name}`}
    >
      <input
        type="hidden"
        name={name}
        value={JSON.stringify(groups.filter((g) => g.all.length > 0))}
      />
      {groups.length === 0 && (
        <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink-3)" }}>{emptyLabel}</p>
      )}
      {groups.map((g, gi) => (
        <div key={gi} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {gi > 0 && (
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: ".08em",
                color: "var(--ink-3)",
              }}
            >
              {t("routes.or").toUpperCase()}
            </div>
          )}
          <div
            style={{
              border: "1px solid var(--line)",
              borderRadius: 10,
              padding: 8,
              display: "flex",
              flexDirection: "column",
              gap: 6,
              background: "var(--sunk)",
            }}
          >
            {g.all.map((c, ci) => (
              <div
                key={ci}
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0,1.2fr) minmax(0,1fr) minmax(0,1.4fr) auto",
                  gap: 6,
                  alignItems: "center",
                }}
              >
                {ci > 0 ? (
                  <span
                    style={{
                      position: "absolute",
                      marginTop: -20,
                      fontSize: 10.5,
                      fontWeight: 700,
                      color: "var(--ink-3)",
                    }}
                  />
                ) : null}
                <select
                  value={c.attribute}
                  onChange={(e) => update(gi, ci, { attribute: e.target.value })}
                  style={control}
                >
                  {!subjects.some((s) => s.key === c.attribute) && (
                    <option value={c.attribute}>{c.attribute}</option>
                  )}
                  {subjects.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </select>
                <select
                  value={c.op}
                  onChange={(e) => update(gi, ci, { op: e.target.value as ConditionOp })}
                  style={control}
                >
                  {OPS.map((op) => (
                    <option key={op} value={op}>
                      {t(`routes.op.${op}`)}
                    </option>
                  ))}
                </select>
                {NO_VALUE.includes(c.op) ? (
                  <span />
                ) : (
                  <input
                    value={c.value ?? ""}
                    onChange={(e) => update(gi, ci, { value: e.target.value })}
                    placeholder={
                      c.op === "in" || c.op === "not_in"
                        ? "P1, P2"
                        : c.op === "matches"
                          ? "regex"
                          : "production"
                    }
                    style={{ ...control, fontFamily: "var(--font-mono)" }}
                  />
                )}
                <button
                  type="button"
                  aria-label={t("common.delete")}
                  onClick={() =>
                    setGroups((gs) =>
                      gs
                        .map((x, i) => (i !== gi ? x : { all: x.all.filter((_, j) => j !== ci) }))
                        .filter((x) => x.all.length > 0),
                    )
                  }
                  style={{ ...small, color: "var(--ink-3)" }}
                >
                  ✕
                </button>
              </div>
            ))}
            <div>
              <button
                type="button"
                style={small}
                onClick={() =>
                  setGroups((gs) => gs.map((x, i) => (i !== gi ? x : { all: [...x.all, blank()] })))
                }
              >
                + {t("routes.andCondition")}
              </button>
            </div>
          </div>
        </div>
      ))}
      <div>
        <button
          type="button"
          style={small}
          onClick={() => setGroups((gs) => [...gs, { all: [blank()] }])}
          data-testid={`conditions-${name}-add`}
        >
          + {groups.length ? t("routes.orGroup") : t("routes.addCondition")}
        </button>
      </div>
    </div>
  );
}
