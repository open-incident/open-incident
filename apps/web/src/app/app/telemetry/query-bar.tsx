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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {/* A GET form: the query lives in the address, so a filtered view is a
            link somebody can paste into an incident. */}
        <form
          method="get"
          action="/app/telemetry"
          style={{ display: "flex", gap: 8, flex: 1, minWidth: 280 }}
        >
          <input type="hidden" name="tab" value={signal} />
          {service && <input type="hidden" name="service" value={service} />}
          <input
            name="q"
            defaultValue={query ?? ""}
            data-testid="explorer-filter"
            spellCheck={false}
            placeholder={t(`explorer.placeholder.${signal}` as MessageKey)}
            className="oi-field"
            style={{ ...CONTROL, flex: 1, fontFamily: "var(--mono)", fontSize: 12 }}
          />
          <button
            type="submit"
            data-testid="explorer-run"
            className="oi-hover-brand-2"
            style={{
              ...CONTROL,
              padding: "0 13px",
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

        {query?.trim() && (
          <>
            {mayEdit && (
              <form action={saveQuery} style={{ display: "flex", gap: 6 }}>
                <input type="hidden" name="signal" value={signal} />
                <input type="hidden" name="query" value={query} />
                {service && <input type="hidden" name="service" value={service} />}
                <input
                  name="name"
                  required
                  placeholder={t("explorer.saveAs")}
                  className="oi-field"
                  style={{ ...CONTROL, width: 150 }}
                />
                <button
                  type="submit"
                  data-testid="explorer-save"
                  style={{ ...CONTROL, cursor: "pointer" }}
                >
                  {t("explorer.save")}
                </button>
              </form>
            )}
            {/* The monitor form takes the same text, so what gets watched is
                what was just looked at. */}
            <Link
              href={`/app/monitors?new=1&type=${signal}&q=${encodeURIComponent(query)}`}
              data-testid="explorer-watch"
              style={{
                ...CONTROL,
                display: "inline-flex",
                alignItems: "center",
                textDecoration: "none",
                color: "var(--brand)",
                borderColor: "var(--brand)",
                fontWeight: 600,
              }}
            >
              {t("explorer.watch")}
            </Link>
          </>
        )}
      </div>

      {saved.length > 0 && (
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--ink-3)" }}>
            {t("explorer.saved")}
          </span>
          {saved.map((s) => (
            <span
              key={s.id}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                border: "1px solid var(--line)",
                borderRadius: 7,
                background: s.query === query ? "var(--brand-t)" : "var(--sunk)",
                paddingRight: 4,
              }}
            >
              <Link
                href={href({ q: s.query })}
                title={s.query}
                style={{
                  fontSize: 11.5,
                  padding: "3px 8px",
                  color: s.query === query ? "var(--brand)" : "var(--ink-2)",
                  textDecoration: "none",
                  fontWeight: s.query === query ? 600 : 400,
                }}
              >
                {s.name}
              </Link>
              {mayEdit && (
                <form action={deleteSavedQuery}>
                  <input type="hidden" name="id" value={s.id} />
                  <input type="hidden" name="signal" value={signal} />
                  <button
                    type="submit"
                    aria-label={t("common.delete")}
                    style={{
                      border: 0,
                      background: "none",
                      color: "var(--ink-3)",
                      cursor: "pointer",
                      fontSize: 11,
                      padding: "0 2px",
                    }}
                  >
                    ✕
                  </button>
                </form>
              )}
            </span>
          ))}
        </div>
      )}

      <span style={{ fontSize: 10.5, color: "var(--ink-3)", lineHeight: 1.45 }}>
        {t("explorer.fields", { fields: fieldsOf(signal).join(", ") })}
      </span>
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
