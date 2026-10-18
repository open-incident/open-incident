"use client";

/**
 * OWNER — the team paged when this service is named, the policy it is paged
 * through, its channel, and "Change owner".
 *
 * The chain is service → team → policy. When the middle link holds and the
 * last one does not (a team with no policy), the choice of a policy is offered
 * right here, where the reader learns that nobody would be paged.
 */

import { useRef, useState, useTransition } from "react";
import { useT } from "@/i18n/client";
import { initials } from "@/i18n/format";
import { assignOwner, clearOwner, setTeamPolicy } from "../actions";
import { MENU, MENU_ITEM, useOutsideClose } from "../dialog";
import { CARD, EYEBROW } from "./ui";

export function OwnerCard({
  service,
  owner,
  teams,
  paths,
  mayEdit,
}: {
  service: { id: string; ownerTeamId: string | null };
  owner: { name: string; policyName: string | null; channel: string | null } | null;
  teams: Array<{ id: string; name: string }>;
  paths: Array<{ id: string; name: string }>;
  mayEdit: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const ref = useRef<HTMLDivElement>(null);
  useOutsideClose(open, () => setOpen(false), ref);

  const pick = (teamId: string | null) => {
    setOpen(false);
    const fd = new FormData();
    fd.set("serviceId", service.id);
    if (teamId) fd.set("teamId", teamId);
    start(() => (teamId ? assignOwner(fd) : clearOwner(fd)));
  };

  return (
    <div style={{ ...CARD, opacity: pending ? 0.7 : 1 }} data-testid="service-owner">
      <div style={EYEBROW}>{t("services.owner")}</div>
      {owner ? (
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span
            style={{
              width: 30,
              height: 30,
              borderRadius: 9,
              background: "var(--brand-t)",
              color: "var(--brand)",
              display: "grid",
              placeItems: "center",
              fontSize: 11,
              fontWeight: 700,
              flex: "none",
            }}
          >
            {owner.name.trim().split(/\s+/).length > 1
              ? initials(owner.name)
              : owner.name.slice(0, 2).toUpperCase()}
          </span>
          <div style={{ lineHeight: 1.25, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>{owner.name}</div>
            <div
              style={{ fontSize: 11.5, color: owner.policyName ? "var(--ink-3)" : "var(--wait)" }}
            >
              {owner.policyName
                ? t("services.pagesPolicy", { policy: owner.policyName })
                : t("services.noPolicy")}
              {owner.channel ? ` · ${owner.channel}` : ""}
            </div>
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 12.5, color: "var(--wait)", fontWeight: 600 }}>
          {t("services.noOwner")}
        </div>
      )}

      {owner && !owner.policyName && mayEdit && paths.length > 0 && service.ownerTeamId && (
        <form
          action={setTeamPolicy}
          style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 2 }}
        >
          <input type="hidden" name="serviceId" value={service.id} />
          <input type="hidden" name="teamId" value={service.ownerTeamId} />
          <label style={{ fontSize: 11.5, color: "var(--ink-3)", lineHeight: 1.4 }}>
            {t("services.setPolicy")}
          </label>
          <div style={{ display: "flex", gap: 6 }}>
            <select
              name="pathId"
              defaultValue={paths[0]!.id}
              style={{
                flex: 1,
                minWidth: 0,
                height: 30,
                border: "1px solid var(--line)",
                borderRadius: 8,
                background: "var(--panel)",
                color: "var(--ink)",
                fontSize: 12.5,
                padding: "0 7px",
              }}
            >
              {paths.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
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
              {t("services.usePolicy")}
            </button>
          </div>
        </form>
      )}

      {mayEdit && (teams.length > 0 || owner) && (
        <div ref={ref} style={{ position: "relative", width: "fit-content" }}>
          <button
            type="button"
            data-testid="owner-change"
            onClick={() => setOpen((o) => !o)}
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "var(--brand)",
              cursor: "pointer",
              border: 0,
              background: "none",
              padding: 0,
            }}
          >
            {owner ? t("services.changeOwner") : t("services.assignOwner")}
          </button>
          {open && (
            <div role="menu" style={{ ...MENU, left: 0, right: "auto" }}>
              {teams.map((x) => (
                <button
                  key={x.id}
                  type="button"
                  role="menuitem"
                  data-testid="owner-option"
                  className="oi-hover"
                  onClick={() => pick(x.id)}
                  style={{
                    ...MENU_ITEM,
                    fontWeight: x.id === service.ownerTeamId ? 700 : 500,
                  }}
                >
                  <span style={{ flex: 1 }}>{x.name}</span>
                  {x.id === service.ownerTeamId && (
                    <span style={{ color: "var(--brand)", fontSize: 12 }}>✓</span>
                  )}
                </button>
              ))}
              {owner && (
                <>
                  <div style={{ height: 1, background: "var(--line-2)", margin: "4px 2px" }} />
                  <button
                    type="button"
                    role="menuitem"
                    data-testid="owner-clear"
                    className="oi-hover"
                    onClick={() => pick(null)}
                    style={{ ...MENU_ITEM, color: "var(--dang)" }}
                  >
                    {t("services.clearOwner")}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
