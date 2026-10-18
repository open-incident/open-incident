"use client";

import Link from "next/link";
import { useState, type CSSProperties, type ReactNode } from "react";
import { useT } from "@/i18n/client";
import { Card } from "@/components/settings/template";
import { StatusesModal, type StatusRow } from "./statuses";
import { TasksModal, type TaskRow } from "./tasks";

/**
 * The lifecycle card (design V2, Types & lifecycle): which type the screen is
 * about — a segmented choice, each type with how many incidents carry it —
 * then its four phases on one line. Triage and Closed are the product's own;
 * Active lists the type's statuses and opens them for editing; Post-incident
 * lists the flow's phases and opens its tasks.
 */
export function Lifecycle({
  types,
  typeId,
  typeName,
  statuses,
  tasks,
  canManage,
  initialOpen,
}: {
  types: Array<{ id: string; name: string; count: number; href: string }>;
  typeId: string;
  typeName: string;
  statuses: StatusRow[];
  tasks: TaskRow[];
  canManage: boolean;
  initialOpen: "statuses" | "post-incident" | null;
}) {
  const t = useT();
  const [open, setOpen] = useState<"statuses" | "post-incident" | null>(
    canManage ? initialOpen : null,
  );
  const phases: Array<{
    key: string;
    label: string;
    color: string;
    flex: string;
    sub: string;
    chips: string[];
    onOpen?: () => void;
    openLabel?: string;
  }> = [
    {
      key: "triage",
      label: t("settingsV2.types.phase.triage"),
      color: "var(--wait)",
      flex: "1",
      sub: t("settingsV2.types.phaseSub.triage"),
      chips: [t("settingsV2.types.chip.triage")],
    },
    {
      key: "active",
      label: t("settingsV2.types.phase.active"),
      color: "var(--dang)",
      flex: "2",
      sub: t("settingsV2.types.phaseSub.active"),
      chips: statuses.map((s) => s.name),
      onOpen: canManage ? () => setOpen("statuses") : undefined,
      openLabel: t("settingsV2.types.editActive", { type: typeName }),
    },
    {
      key: "post",
      label: t("settingsV2.types.phase.post"),
      color: "var(--brand)",
      flex: "1.6",
      sub: t("settingsV2.types.phaseSub.post"),
      chips: [t("settingsV2.types.chip.documenting"), t("settingsV2.types.chip.reviewing")],
      onOpen: canManage ? () => setOpen("post-incident") : undefined,
      openLabel: t("settingsV2.types.editPost"),
    },
    {
      key: "closed",
      label: t("settingsV2.types.phase.closed"),
      color: "var(--ok)",
      flex: "1",
      sub: t("settingsV2.types.phaseSub.closed"),
      chips: [t("settingsV2.types.chip.closed")],
    },
  ];

  return (
    <Card padding="14px 18px" gap={14} testId="lifecycle">
      <nav
        aria-label={t("settingsV2.types.switcher")}
        data-testid="type-switcher"
        style={{
          display: "flex",
          gap: 2,
          background: "var(--sunk)",
          borderRadius: 10,
          padding: 3,
          alignSelf: "flex-start",
          flexWrap: "wrap",
        }}
      >
        {types.map((ty) => {
          const on = ty.id === typeId;
          return (
            <Link
              key={ty.id}
              href={ty.href}
              scroll={false}
              aria-current={on ? "page" : undefined}
              data-type={ty.name}
              style={{
                height: 30,
                padding: "0 13px",
                borderRadius: 8,
                background: on ? "var(--panel)" : "transparent",
                boxShadow: on ? "0 1px 2px rgba(13,22,28,.12)" : "none",
                display: "flex",
                alignItems: "center",
                gap: 7,
                fontSize: 13,
                fontWeight: on ? 600 : 500,
                cursor: "pointer",
                whiteSpace: "nowrap",
                color: "var(--ink)",
                textDecoration: "none",
              }}
            >
              {ty.name}
              <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--ink-3)" }}>
                {ty.count}
              </span>
            </Link>
          );
        })}
      </nav>
      <div style={{ display: "flex", gap: 8, alignItems: "stretch", flexWrap: "wrap" }}>
        {phases.map(({ key, ...ph }) => (
          <Phase key={key} {...ph} testId={`phase-${key}`} />
        ))}
      </div>
      {open === "statuses" && (
        <StatusesModal
          typeId={typeId}
          typeName={typeName}
          statuses={statuses}
          onClose={() => setOpen(null)}
        />
      )}
      {open === "post-incident" && <TasksModal tasks={tasks} onClose={() => setOpen(null)} />}
    </Card>
  );
}

function Phase({
  label,
  color,
  flex,
  sub,
  chips,
  onOpen,
  openLabel,
  testId,
}: {
  label: string;
  color: string;
  flex: string;
  sub: string;
  chips: string[];
  onOpen?: () => void;
  openLabel?: string;
  testId: string;
}) {
  const style: CSSProperties = {
    flex,
    minWidth: 150,
    border: "1px solid var(--line)",
    borderTop: `3px solid ${color}`,
    borderRadius: 12,
    padding: "10px 12px",
    display: "flex",
    flexDirection: "column",
    gap: 6,
    background: "transparent",
    textAlign: "left",
    font: "inherit",
    color: "inherit",
  };
  const body: ReactNode = (
    <>
      <div
        style={{
          fontSize: 10.5,
          fontWeight: 700,
          letterSpacing: ".08em",
          textTransform: "uppercase",
          color,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 12, color: "var(--ink-2)", lineHeight: 1.45 }}>{sub}</div>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: "auto" }}>
        {chips.map((c, i) => (
          <span
            key={`${c}-${i}`}
            style={{
              fontSize: 11.5,
              fontWeight: 600,
              background: "var(--sunk)",
              borderRadius: 999,
              padding: "2px 9px",
            }}
          >
            {c}
          </span>
        ))}
      </div>
    </>
  );
  if (!onOpen)
    return (
      <div data-testid={testId} style={style}>
        {body}
      </div>
    );
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onOpen}
      title={openLabel}
      aria-label={openLabel}
      className="oi-hover"
      style={{ ...style, cursor: "pointer" }}
    >
      {body}
    </button>
  );
}
