import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { savedQueries, withTenant, type SavedQuerySignal } from "@openincident/db";
import { fieldsOf } from "@openincident/telemetry";
import { getT } from "@/i18n/server";
import { deleteSavedQuery, saveQuery } from "./actions";
import type { MessageKey } from "@/i18n/dictionaries/en";

const CONTROL: React.CSSProperties = {
  height: 32,
  border: "1px solid var(--line)",
  borderRadius: 8,
  padding: "0 10px",
  fontSize: 12.5,
  background: "var(--panel)",
  outline: "none",
};

/**
 * The filter box every explorer shares, with what to do once it works.
 *
 * One language across Logs, Traces and Exceptions, and it is the same one the
 * monitors take. That is what makes the last button on this bar honest: "watch
 * this" hands the monitor form the exact text that is in the box, so the thing
 * being alerted on is the thing that was just looked at — not a
 * re-interpretation of it.
 *
 * Saved queries sit beside the box rather than behind a menu, because the
 * moment somebody wants one is the moment they are staring at an empty box
 * during an incident.
 */
export async function QueryBar({
  tenantId,
  signal,
  query,
  service,
  mayEdit,
}: {
  tenantId: string;
  signal: Exclude<SavedQuerySignal, "sql" | "metrics">;
  query?: string;
  service?: string;
  mayEdit: boolean;
}) {
  const t = await getT();
  const saved = await withTenant(tenantId, (tx) =>
    tx
      .select({ id: savedQueries.id, name: savedQueries.name, query: savedQueries.query })
      .from(savedQueries)
      .where(and(eq(savedQueries.tenantId, tenantId), eq(savedQueries.signal, signal)))
      .orderBy(asc(savedQueries.name)),
  );

  const href = (over: Record<string, string>) => {
    const p = new URLSearchParams({
      tab: signal,
      ...(service ? { service } : {}),
      ...over,
    });
    return `/app/telemetry?${p.toString()}`;
  };

  const menu: React.CSSProperties = {
    position: "absolute",
    top: 38,
    right: 0,
    zIndex: 20,
    minWidth: 280,
    maxWidth: 460,
    padding: 10,
    background: "var(--panel)",
    border: "1px solid var(--line)",
    borderRadius: 10,
    boxShadow: "var(--shadow-card-hover)",
  };
  const summary: React.CSSProperties = {
    ...CONTROL,
    listStyle: "none",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    cursor: "pointer",
    color: "var(--ink-2)",
    fontWeight: 600,
    whiteSpace: "nowrap",
  };

  /*
   * One line, as in Sumo Logic and Datadog: the query across the width, the
   * button that runs it, and what to do with it once it works. The saved
   * searches and the syntax wait behind two menus — they used to sit under the
   * box as a row of chips and a paragraph, and pushed the results down.
   */
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      {/* A GET form: the query lives in the address, so a filtered view is a
          link somebody can paste into an incident. */}
      <form
        method="get"
        action="/app/telemetry"
        style={{ display: "flex", gap: 8, flex: 1, minWidth: 320 }}
      >
        <input type="hidden" name="tab" value={signal} />
        {service && <input type="hidden" name="service" value={service} />}
        <span style={{ position: "relative", flex: 1, display: "flex" }}>
          <span
            aria-hidden
            style={{
              position: "absolute",
              left: 11,
              top: 8,
              fontSize: 12,
              color: "var(--ink-3)",
              pointerEvents: "none",
            }}
          >
            ⌕
          </span>
          <input
            name="q"
            defaultValue={query ?? ""}
            data-testid="explorer-filter"
            spellCheck={false}
            placeholder={t(`explorer.placeholder.${signal}` as MessageKey)}
            className="oi-field"
            style={{
              ...CONTROL,
              height: 34,
              flex: 1,
              paddingLeft: 30,
              fontFamily: "var(--mono)",
              fontSize: 12.5,
            }}
          />
        </span>
        <button
          type="submit"
          data-testid="explorer-run"
          className="oi-hover-brand-2"
          style={{
            ...CONTROL,
            height: 34,
            padding: "0 16px",
            background: "var(--brand)",
            color: "var(--on-brand)",
            border: 0,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {t("explorer.filter")}
        </button>
      </form>

      {saved.length > 0 && (
        <details style={{ position: "relative" }} data-testid="explorer-saved">
          <summary style={summary}>
            {t("explorer.saved")} · {saved.length} <span aria-hidden>▾</span>
          </summary>
          <div style={{ ...menu, display: "flex", flexDirection: "column", gap: 2 }}>
            {saved.map((s) => (
              <span
                key={s.id}
                style={{ display: "flex", alignItems: "center", gap: 6, borderRadius: 7 }}
              >
                <Link
                  href={href({ q: s.query })}
                  title={s.query}
                  className="oi-hover"
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: 12.5,
                    padding: "6px 8px",
                    borderRadius: 7,
                    color: s.query === query ? "var(--brand)" : "var(--ink)",
                    fontWeight: s.query === query ? 600 : 500,
                    textDecoration: "none",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {s.name}
                  <span
                    style={{
                      display: "block",
                      fontFamily: "var(--mono)",
                      fontSize: 10.5,
                      color: "var(--ink-3)",
                      fontWeight: 400,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {s.query}
                  </span>
                </Link>
                {mayEdit && (
                  <form action={deleteSavedQuery}>
                    <input type="hidden" name="id" value={s.id} />
                    <input type="hidden" name="signal" value={signal} />
                    <button
                      type="submit"
                      aria-label={t("common.delete")}
                      className="oi-hover-dang"
                      style={{
                        border: 0,
                        background: "none",
                        color: "var(--ink-3)",
                        cursor: "pointer",
                        fontSize: 11,
                        width: 24,
                        height: 24,
                        borderRadius: 6,
                      }}
                    >
                      ✕
                    </button>
                  </form>
                )}
              </span>
            ))}
          </div>
        </details>
      )}

      {query?.trim() && mayEdit && (
        <details style={{ position: "relative" }}>
          <summary style={summary} data-testid="explorer-save-open">
            {t("explorer.save")} <span aria-hidden>▾</span>
          </summary>
          <form action={saveQuery} style={{ ...menu, display: "flex", gap: 6 }}>
            <input type="hidden" name="signal" value={signal} />
            <input type="hidden" name="query" value={query} />
            {service && <input type="hidden" name="service" value={service} />}
            <input
              name="name"
              required
              autoFocus
              placeholder={t("explorer.saveAs")}
              className="oi-field"
              style={{ ...CONTROL, flex: 1 }}
            />
            <button
              type="submit"
              data-testid="explorer-save"
              className="oi-hover-brand-2"
              style={{
                ...CONTROL,
                background: "var(--brand)",
                color: "var(--on-brand)",
                border: 0,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {t("explorer.save")}
            </button>
          </form>
        </details>
      )}

      {/* The monitor form takes the same text, so what gets watched is what
          was just looked at. */}
      {query?.trim() && (
        <Link
          href={`/app/monitors?new=1&type=${signal}&q=${encodeURIComponent(query)}`}
          data-testid="explorer-watch"
          style={{
            ...CONTROL,
            display: "inline-flex",
            alignItems: "center",
            textDecoration: "none",
            color: "var(--brand)",
            borderColor: "var(--brand-b)",
            fontWeight: 600,
          }}
        >
          {t("explorer.watch")}
        </Link>
      )}

      <details style={{ position: "relative" }}>
        <summary style={summary} aria-label={t("explorer.syntax")}>
          {t("explorer.syntax")} <span aria-hidden>?</span>
        </summary>
        <div style={{ ...menu, fontSize: 12, color: "var(--ink-2)", lineHeight: 1.55 }}>
          {t("explorer.fields", { fields: fieldsOf(signal).join(", ") })}
        </div>
      </details>
    </div>
  );
}

/**
 * What went wrong with a filter, shown where it was typed.
 *
 * The compiler refuses by naming the field it does not have and listing the
 * ones it does, which is most of the teaching — so the message is passed
 * through rather than replaced by "invalid query".
 */
export async function FilterError({ message }: { message: string }) {
  return (
    <div
      role="alert"
      data-testid="explorer-error"
      style={{
        border: "1px solid var(--dang)",
        background: "var(--dang-t)",
        color: "var(--dang)",
        borderRadius: 10,
        padding: "10px 13px",
        fontSize: 12.5,
        lineHeight: 1.5,
      }}
    >
      {message}
    </div>
  );
}
