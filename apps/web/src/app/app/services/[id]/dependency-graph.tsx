"use client";

/**
 * Dependencies — callers on the left, this service in the middle, what it
 * calls on the right; a solid border for a link somebody declared, a dashed
 * one for a call only the traces saw. Clicking a neighbour opens what can be
 * done with it: open it, confirm the call, hide it, take a decision back.
 */

import { useRef, useState, useTransition } from "react";
import { useT } from "@/i18n/client";
import type { DependencyNode } from "@/lib/services";
import { setDependency } from "../actions";
import { MENU, MENU_ITEM, useOutsideClose } from "../dialog";
import { CARD } from "./ui";

const NODE: React.CSSProperties = {
  borderRadius: 8,
  padding: "6px 10px",
  fontFamily: "var(--mono)",
  fontSize: 12,
  whiteSpace: "nowrap",
};

export function DependencyGraph({
  service,
  nodes,
  others,
  tracesInstalled,
  days,
  mayEdit,
}: {
  service: { id: string; key: string };
  nodes: DependencyNode[];
  others: Array<{ id: string; key: string }>;
  tracesInstalled: boolean;
  days: number;
  mayEdit: boolean;
}) {
  const t = useT();
  const [pending, start] = useTransition();
  const [adding, setAdding] = useState(false);
  const [showHidden, setShowHidden] = useState(false);

  const act = (
    node: { serviceId: string | null; key: string; direction: "upstream" | "downstream" },
    state: "declared" | "hidden" | "clear",
  ) => {
    const fd = new FormData();
    fd.set("serviceId", service.id);
    if (node.serviceId) fd.set("otherId", node.serviceId);
    else fd.set("otherKey", node.key);
    fd.set("direction", node.direction);
    fd.set("state", state);
    start(() => setDependency(fd));
  };

  const visible = nodes.filter((n) => !n.hidden);
  const hidden = nodes.filter((n) => n.hidden);
  const up = visible.filter((n) => n.direction === "upstream");
  const down = visible.filter((n) => n.direction === "downstream");

  return (
    <div
      style={{ ...CARD, gap: 10, opacity: pending ? 0.7 : 1 }}
      data-testid="service-dependencies"
    >
      <div style={{ display: "flex", alignItems: "center" }}>
        <span style={{ fontSize: 13.5, fontWeight: 600 }}>{t("services.dependencies")}</span>
        <span style={{ fontSize: 11.5, color: "var(--ink-3)", marginLeft: 10 }}>
          {tracesInstalled ? t("services.depSubtitle") : t("services.depSubtitleDeclared")}
        </span>
        <span style={{ flex: 1 }} />
        {mayEdit && others.length > 0 && (
          <button
            type="button"
            data-testid="dependency-add"
            onClick={() => setAdding((a) => !a)}
            style={{
              fontSize: 11.5,
              fontWeight: 600,
              color: "var(--brand)",
              border: 0,
              background: "none",
              cursor: "pointer",
              padding: 0,
            }}
          >
            {t("services.depAdd")}
          </button>
        )}
      </div>

      {adding && (
        <DeclareForm
          others={others}
          onDone={(otherId, direction) => {
            setAdding(false);
            act({ serviceId: otherId, key: "", direction }, "declared");
          }}
        />
      )}

      {visible.length === 0 ? (
        <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.55 }}>
          {tracesInstalled
            ? t("services.dependenciesEmptyDays", { count: days })
            : t("services.dependenciesNoneDeclared")}
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {up.length > 0 && (
            <>
              <Column nodes={up} onAct={act} mayEdit={mayEdit} align="flex-end" />
              <span style={{ color: "var(--ink-3)", fontFamily: "var(--mono)", fontSize: 12 }}>
                →
              </span>
            </>
          )}
          <span
            data-testid="dependency-self"
            style={{
              ...NODE,
              border: "1.5px solid var(--brand)",
              background: "var(--brand-t)",
              fontWeight: 600,
              color: "var(--brand)",
            }}
          >
            {service.key}
          </span>
          {down.length > 0 && (
            <>
              <span style={{ color: "var(--ink-3)", fontFamily: "var(--mono)", fontSize: 12 }}>
                →
              </span>
              <Column nodes={down} onAct={act} mayEdit={mayEdit} align="flex-start" />
            </>
          )}
        </div>
      )}

      <div
        style={{ display: "flex", gap: 6, fontSize: 11, flexWrap: "wrap", alignItems: "center" }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 5, color: "var(--ink-3)" }}>
          <span style={{ width: 12, height: 1.5, background: "var(--ink-3)" }} />
          {t("services.depDeclared")}
        </span>
        {tracesInstalled && (
          <span style={{ display: "flex", alignItems: "center", gap: 5, color: "var(--ink-3)" }}>
            <span style={{ width: 12, borderTop: "1.5px dashed var(--ink-3)" }} />
            {t("services.depObservedDays", { count: days })}
          </span>
        )}
        {hidden.length > 0 && (
          <button
            type="button"
            data-testid="dependency-hidden-toggle"
            onClick={() => setShowHidden((s) => !s)}
            style={{
              border: 0,
              background: "none",
              padding: 0,
              fontSize: 11,
              color: "var(--ink-3)",
              cursor: "pointer",
              textDecoration: "underline dotted",
            }}
          >
            · {t("services.depHiddenCount", { count: hidden.length })}
          </button>
        )}
      </div>
      {showHidden && hidden.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {hidden.map((n) => (
            <span
              key={`${n.direction}:${n.key}`}
              style={{
                ...NODE,
                border: "1px dashed var(--line)",
                color: "var(--ink-3)",
                display: "inline-flex",
                gap: 8,
                alignItems: "center",
              }}
            >
              {n.direction === "upstream" ? `${n.key} →` : `→ ${n.key}`}
              {mayEdit && (
                <button
                  type="button"
                  data-testid="dependency-unhide"
                  onClick={() => act(n, "clear")}
                  style={{
                    border: 0,
                    background: "none",
                    padding: 0,
                    color: "var(--brand)",
                    fontWeight: 600,
                    fontSize: 11,
                    cursor: "pointer",
                    fontFamily: "var(--font-ui)",
                  }}
                >
                  {t("services.depUnhide")}
                </button>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Column({
  nodes,
  onAct,
  mayEdit,
  align,
}: {
  nodes: DependencyNode[];
  onAct: (n: DependencyNode, state: "declared" | "hidden" | "clear") => void;
  mayEdit: boolean;
  align: "flex-start" | "flex-end";
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: align }}>
      {nodes.map((n) => (
        <Node key={`${n.direction}:${n.key}`} node={n} onAct={onAct} mayEdit={mayEdit} />
      ))}
    </div>
  );
}

function Node({
  node,
  onAct,
  mayEdit,
}: {
  node: DependencyNode;
  onAct: (n: DependencyNode, state: "declared" | "hidden" | "clear") => void;
  mayEdit: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutsideClose(open, () => setOpen(false), ref);
  const tone =
    node.state === "offline"
      ? { bd: "var(--dang)", bg: "var(--dang-t)", ink: "var(--dang)" }
      : node.state === "degraded"
        ? { bd: "var(--wait)", bg: "var(--wait-t)", ink: "var(--wait)" }
        : { bd: "var(--line)", bg: "transparent", ink: "var(--ink-2)" };
  const style = node.declared ? "solid" : "dashed";
  const rate =
    node.observed && node.observed.calls > 0
      ? (node.observed.errors / node.observed.calls) * 100
      : null;
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        data-testid="service-dependency"
        data-declared={node.declared ? "1" : "0"}
        onClick={() => setOpen((o) => !o)}
        style={{
          ...NODE,
          border: `1px ${style} ${tone.bd}`,
          background: tone.bg,
          color: tone.ink,
          cursor: "pointer",
        }}
      >
        {`${node.key}${node.state === "degraded" ? ` · ${t("services.depDegraded")}` : node.state === "offline" ? ` · ${t("services.depDown")}` : ""}`}
      </button>
      {open && (
        <div role="menu" style={{ ...MENU, left: 0, right: "auto", minWidth: 240 }}>
          <div
            style={{
              padding: "6px 10px 8px",
              fontSize: 11.5,
              color: "var(--ink-3)",
              lineHeight: 1.45,
            }}
          >
            {node.observed
              ? t("services.depEdge", {
                  count: node.observed.calls,
                  p95: node.observed.p95Ms.toFixed(0),
                  rate: (rate ?? 0).toFixed(1),
                })
              : t("services.depDeclaredOnly")}
          </div>
          {node.serviceId && (
            <a
              href={`/app/services/${node.serviceId}`}
              role="menuitem"
              className="oi-hover"
              style={{ ...MENU_ITEM, textDecoration: "none" }}
            >
              {t("services.depOpen")}
            </a>
          )}
          {mayEdit && !node.declared && (
            <button
              type="button"
              role="menuitem"
              data-testid="dependency-confirm"
              className="oi-hover"
              onClick={() => {
                setOpen(false);
                onAct(node, "declared");
              }}
              style={MENU_ITEM}
            >
              {t("services.depConfirm")}
            </button>
          )}
          {mayEdit && node.declared && (
            <button
              type="button"
              role="menuitem"
              data-testid="dependency-clear"
              className="oi-hover"
              onClick={() => {
                setOpen(false);
                onAct(node, "clear");
              }}
              style={MENU_ITEM}
            >
              {node.observed ? t("services.depUnconfirm") : t("services.depRemove")}
            </button>
          )}
          {mayEdit && node.observed && (
            <button
              type="button"
              role="menuitem"
              data-testid="dependency-hide"
              className="oi-hover"
              onClick={() => {
                setOpen(false);
                onAct(node, "hidden");
              }}
              style={MENU_ITEM}
            >
              {t("services.depHide")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function DeclareForm({
  others,
  onDone,
}: {
  others: Array<{ id: string; key: string }>;
  onDone: (otherId: string, direction: "upstream" | "downstream") => void;
}) {
  const t = useT();
  const [direction, setDirection] = useState<"upstream" | "downstream">("downstream");
  const [otherId, setOtherId] = useState(others[0]?.id ?? "");
  const control: React.CSSProperties = {
    height: 30,
    border: "1px solid var(--line)",
    borderRadius: 8,
    background: "var(--panel)",
    color: "var(--ink)",
    fontSize: 12.5,
    padding: "0 7px",
  };
  return (
    <form
      data-testid="dependency-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (otherId) onDone(otherId, direction);
      }}
      style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}
    >
      <select
        value={direction}
        onChange={(e) => setDirection(e.target.value as "upstream" | "downstream")}
        style={control}
      >
        <option value="downstream">{t("services.depItCalls")}</option>
        <option value="upstream">{t("services.depCalledBy")}</option>
      </select>
      <select
        value={otherId}
        onChange={(e) => setOtherId(e.target.value)}
        style={{ ...control, fontFamily: "var(--mono)" }}
      >
        {others.map((o) => (
          <option key={o.id} value={o.id}>
            {o.key}
          </option>
        ))}
      </select>
      <button
        type="submit"
        className="oi-hover-brand-2"
        style={{
          height: 30,
          padding: "0 11px",
          border: "none",
          borderRadius: 8,
          background: "var(--brand)",
          color: "var(--on-brand)",
          fontSize: 12,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        {t("services.depDeclare")}
      </button>
    </form>
  );
}
