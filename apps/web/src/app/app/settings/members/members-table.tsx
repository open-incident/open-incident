"use client";

import { useMemo, useState, useTransition, type CSSProperties } from "react";
import { useT } from "@/i18n/client";
import { flash } from "@/components/settings/controls";
import { FilterCount, TONES, cardStyle, filterChipStyle } from "@/components/settings/template";
import { disableMember, resendInvite, revokeInvite, updateRole, type RowResult } from "./actions";

export type MembersFilter = "all" | "active" | "invited" | "disabled";

export type MemberRow = {
  id: string;
  /** What the row's title says: the name, or the address of an invitation. */
  name: string;
  realName: string;
  email: string;
  sub: string;
  initials: string;
  tone: { bg: string; ink: string };
  you: boolean;
  status: "active" | "invited" | "disabled";
  roleValue: string;
  roleLabel: string;
  canEditRole: boolean;
  teams: string;
  method: "sso" | "password" | "none" | "invited" | "disabled";
  last: string;
  action: "disable" | "reactivate" | "resend" | "managed" | null;
};

const GRID = "minmax(230px,1.6fr) 170px minmax(110px,1fr) 96px 120px 110px";

const ellipsis: CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

/**
 * The members card of the design: the filter chips and the search on its
 * head, then the table. Filtering and search are local — the whole list is
 * already here — and the deep link `?f=invited` opens on its filter.
 */
export function MembersTable({
  rows,
  roleOptions,
  initialFilter,
  provider,
}: {
  rows: MemberRow[];
  roleOptions: Array<{ value: string; label: string }>;
  initialFilter: MembersFilter;
  /** The identity provider's name — the first SSO connection — for "Managed by …". */
  provider: string;
}) {
  const t = useT();
  const [filter, setFilter] = useState<MembersFilter>(initialFilter);
  const [q, setQ] = useState("");

  const counts = useMemo(
    () => ({
      all: rows.length,
      active: rows.filter((r) => r.status === "active").length,
      invited: rows.filter((r) => r.status === "invited").length,
      disabled: rows.filter((r) => r.status === "disabled").length,
    }),
    [rows],
  );
  const needle = q.trim().toLowerCase();
  const shown = rows.filter(
    (r) =>
      (filter === "all" || r.status === filter) &&
      (!needle || `${r.realName} ${r.email}`.toLowerCase().includes(needle)),
  );

  const filters: Array<{ key: MembersFilter; label: string }> = [
    { key: "all", label: t("settingsV2.members.filter.all") },
    { key: "active", label: t("settingsV2.members.filter.active") },
    { key: "invited", label: t("settingsV2.members.filter.invited") },
    { key: "disabled", label: t("settingsV2.members.filter.disabled") },
  ];

  return (
    <section data-testid="members-card" style={cardStyle}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "12px 18px",
          flexWrap: "wrap",
        }}
      >
        {filters.map((f) => (
          <button
            key={f.key}
            type="button"
            data-filter={f.key}
            aria-pressed={filter === f.key}
            onClick={() => setFilter(f.key)}
            style={filterChipStyle(filter === f.key)}
          >
            {f.label}
            <FilterCount>{counts[f.key]}</FilterCount>
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("settingsV2.members.search")}
          aria-label={t("settingsV2.members.search")}
          data-testid="members-search"
          className="oi-field"
          style={{
            height: 32,
            width: 220,
            maxWidth: "100%",
            border: "1px solid var(--line)",
            borderRadius: 9,
            padding: "0 11px",
            fontSize: 12.5,
            background: "var(--panel)",
            color: "var(--ink)",
            outline: "none",
          }}
        />
      </div>
      <div style={{ overflowX: "auto" }}>
        <div style={{ minWidth: 820 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: GRID,
              gap: 12,
              padding: "8px 18px",
              borderTop: "1px solid var(--line)",
              background: "var(--sunk)",
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: ".06em",
              textTransform: "uppercase",
              color: "var(--ink-3)",
            }}
          >
            <span>{t("settingsV2.members.col.member")}</span>
            <span>{t("settingsV2.members.col.role")}</span>
            <span>{t("settingsV2.members.col.teams")}</span>
            <span>{t("settingsV2.members.col.signIn")}</span>
            <span>{t("settingsV2.members.col.last")}</span>
            <span />
          </div>
          {shown.map((r) => (
            <Row key={r.id} row={r} roleOptions={roleOptions} provider={provider} />
          ))}
          {shown.length === 0 && (
            <div
              style={{
                padding: "14px 18px",
                borderTop: "1px solid var(--line-2)",
                fontSize: 12.5,
                color: "var(--ink-3)",
              }}
            >
              {t("settingsV2.members.empty")}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function Row({
  row: r,
  roleOptions,
  provider,
}: {
  row: MemberRow;
  roleOptions: Array<{ value: string; label: string }>;
  provider: string;
}) {
  const t = useT();
  const [pending, start] = useTransition();

  const run = (
    action: (fd: FormData) => Promise<RowResult>,
    fields: Record<string, string>,
    done: string,
  ) =>
    start(async () => {
      const fd = new FormData();
      for (const [k, v] of Object.entries(fields)) fd.set(k, v);
      const res = await action(fd);
      flash(res.ok ? done : res.error);
    });

  const chip = (() => {
    switch (r.method) {
      case "sso":
        return { label: t("settingsV2.members.method.sso"), ...TONES.brand };
      case "password":
        return { label: t("settingsV2.members.method.password"), ...TONES.mute };
      case "invited":
        return { label: t("settingsV2.members.method.invited"), ...TONES.wait };
      case "disabled":
        return { label: t("settingsV2.members.method.disabled"), ...TONES.mute };
      default:
        return null;
    }
  })();

  const act = (() => {
    switch (r.action) {
      case "disable":
        return {
          label: t("settingsV2.members.disable"),
          ink: "var(--dang)",
          testId: "member-disable",
          onClick: () =>
            run(
              disableMember,
              { memberId: r.id },
              t("settingsV2.members.flash.disabled", { name: r.realName }),
            ),
        };
      case "reactivate":
        return {
          label: t("settingsV2.members.reactivate"),
          ink: "var(--brand)",
          testId: "member-disable",
          onClick: () =>
            run(
              disableMember,
              { memberId: r.id },
              t("settingsV2.members.flash.reactivated", { name: r.realName }),
            ),
        };
      case "resend":
        return {
          label: t("settingsV2.members.resend"),
          ink: "var(--brand)",
          testId: "member-resend",
          onClick: () =>
            run(
              resendInvite,
              { memberId: r.id },
              t("settingsV2.members.flash.resent", { email: r.email }),
            ),
        };
      case "managed":
        return {
          label: t("settingsV2.members.managed", { provider }),
          ink: "var(--ink-3)",
          testId: "member-managed",
          onClick: () =>
            flash(t("settingsV2.members.flash.managed", { name: r.realName, provider })),
        };
      default:
        return null;
    }
  })();

  const textButton = (ink: string): CSSProperties => ({
    fontSize: 12,
    fontWeight: 600,
    color: ink,
    cursor: pending ? "default" : "pointer",
    whiteSpace: "nowrap",
    background: "transparent",
    border: 0,
    padding: 0,
    fontFamily: "inherit",
    opacity: pending ? 0.6 : 1,
  });

  return (
    <div
      data-member-email={r.email}
      data-status={r.status}
      style={{
        display: "grid",
        gridTemplateColumns: GRID,
        gap: 12,
        alignItems: "center",
        padding: "10px 18px",
        borderTop: "1px solid var(--line-2)",
        opacity: r.status === "disabled" ? 0.6 : 1,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        <span
          aria-hidden
          style={{
            width: 30,
            height: 30,
            borderRadius: "50%",
            background: r.tone.bg,
            color: r.tone.ink,
            display: "grid",
            placeItems: "center",
            fontSize: 10.5,
            fontWeight: 700,
            flex: "none",
          }}
        >
          {r.initials}
        </span>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 13.5,
              fontWeight: 600,
              whiteSpace: "nowrap",
            }}
          >
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</span>
            {r.you && (
              <span
                style={{
                  fontSize: 10.5,
                  fontWeight: 600,
                  background: "var(--brand-t)",
                  color: "var(--brand)",
                  borderRadius: 999,
                  padding: "0 7px",
                }}
              >
                {t("settingsV2.members.you")}
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, color: "var(--ink-3)", ...ellipsis }}>{r.sub}</div>
        </div>
      </div>
      <div>
        {r.canEditRole ? (
          <select
            key={r.roleValue}
            defaultValue={r.roleValue}
            aria-label={t("settingsV2.members.roleOf", { name: r.realName })}
            disabled={pending}
            onChange={(e) => {
              const value = e.currentTarget.value;
              const label = roleOptions.find((o) => o.value === value)?.label ?? value;
              run(
                updateRole,
                { memberId: r.id, role: value },
                t("settingsV2.members.flash.role", { name: r.realName, role: label }),
              );
            }}
            className="oi-field"
            style={{
              width: "100%",
              height: 30,
              border: "1px solid var(--line)",
              borderRadius: 8,
              padding: "0 7px",
              fontSize: 12.5,
              background: "var(--panel)",
              color: "var(--ink)",
              outline: "none",
            }}
          >
            {roleOptions.some((o) => o.value === r.roleValue) ? null : (
              <option value={r.roleValue}>{r.roleLabel}</option>
            )}
            {roleOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : (
          <span style={{ fontSize: 12.5, color: "var(--ink-2)" }}>{r.roleLabel}</span>
        )}
      </div>
      <span style={{ fontSize: 12.5, color: "var(--ink-2)", ...ellipsis }}>{r.teams}</span>
      <span>
        {chip ? (
          <span
            data-testid="member-method"
            style={{
              fontSize: 11,
              fontWeight: 600,
              borderRadius: 999,
              padding: "2px 9px",
              background: chip.bg,
              color: chip.ink,
              whiteSpace: "nowrap",
            }}
          >
            {chip.label}
          </span>
        ) : (
          <span
            title={t("settingsV2.members.method.none")}
            style={{ fontSize: 12.5, color: "var(--ink-3)" }}
          >
            —
          </span>
        )}
      </span>
      <span style={{ fontSize: 12, color: "var(--ink-3)", ...ellipsis }} title={r.last}>
        {r.last}
      </span>
      <span
        style={{
          textAlign: "right",
          display: "flex",
          justifyContent: "flex-end",
          gap: 10,
          minWidth: 0,
        }}
      >
        {r.status === "invited" && r.action === "resend" && (
          <button
            type="button"
            data-testid="member-revoke"
            disabled={pending}
            onClick={() =>
              run(
                revokeInvite,
                { memberId: r.id },
                t("settingsV2.members.flash.revoked", { email: r.email }),
              )
            }
            className="oi-hover-edge-ink"
            style={textButton("var(--ink-3)")}
          >
            {t("settingsV2.members.revoke")}
          </button>
        )}
        {act && (
          <button
            type="button"
            data-testid={act.testId}
            disabled={pending}
            onClick={act.onClick}
            style={{ ...textButton(act.ink), ...ellipsis }}
          >
            {act.label}
          </button>
        )}
      </span>
    </div>
  );
}
