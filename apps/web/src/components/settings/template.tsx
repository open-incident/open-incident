import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

/**
 * The one template every settings screen is drawn on (design V2,
 * V2Settings): a header — breadcrumb, title, one sentence, actions — then
 * blocks of the same few kinds, read top to bottom:
 *
 * - a form card: rows with the label and its help on the left, the control
 *   on the right;
 * - a list card: objects on the same row template — a number, a glyph or a
 *   dot, the name and one line under it, chips, a figure, one button;
 * - filter chips, a strip of figures, a block of code to copy, a note, and
 *   the honest "unavailable on this instance".
 *
 * The one save bar of a screen is the SettingsForm's (settings-form.tsx); it
 * lands in the slot this header leaves at the end of the page, so it is
 * always the last thing on the screen, wherever the form's fields are.
 *
 * Everything here renders on the server as well as inside a client
 * component: plain props, inline styles as the design writes them, hover and
 * focus through the shared `oi-hover*` / `oi-field` classes.
 */

export type Tone = "ok" | "wait" | "dang" | "open" | "viol" | "brand" | "mute";

export const TONES: Record<Tone, { bg: string; ink: string }> = {
  ok: { bg: "var(--ok-t)", ink: "var(--ok)" },
  wait: { bg: "var(--wait-t)", ink: "var(--wait)" },
  dang: { bg: "var(--dang-t)", ink: "var(--dang)" },
  open: { bg: "var(--open-t)", ink: "var(--open)" },
  viol: { bg: "var(--viol-t)", ink: "var(--viol)" },
  brand: { bg: "var(--brand-t)", ink: "var(--brand)" },
  mute: { bg: "var(--sunk)", ink: "var(--ink-2)" },
};

export const cardStyle: CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius-card)",
  boxShadow: "var(--shadow-card)",
  overflow: "hidden",
};

/** The page entrance — `backwards`, never `both`: a resting transform breaks every fixed descendant. */
export const RISE = "oi-rise .16s ease backwards";

/* ---------- Header ---------- */

export function pageActionStyle(primary?: boolean, danger?: boolean): CSSProperties {
  return {
    height: 34,
    padding: "0 14px",
    borderRadius: 9,
    border: `1px solid ${primary ? "var(--brand)" : "var(--line)"}`,
    background: primary ? "var(--brand)" : "var(--panel)",
    color: primary ? "#fff" : danger ? "var(--dang)" : "var(--ink)",
    display: "flex",
    alignItems: "center",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    whiteSpace: "nowrap",
    textDecoration: "none",
    fontFamily: "inherit",
  };
}

export function pageActionClass(primary?: boolean, danger?: boolean): string {
  return primary ? "oi-hover-brand-2" : danger ? "oi-hover-dang" : "oi-hover";
}

/** A header action that navigates. Dialog triggers and submit buttons reuse `pageActionStyle`. */
export function PageLink({
  href,
  primary,
  danger,
  children,
  testId,
  external,
}: {
  href: string;
  primary?: boolean;
  danger?: boolean;
  children: ReactNode;
  testId?: string;
  external?: boolean;
}) {
  const style = pageActionStyle(primary, danger);
  if (external)
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        data-testid={testId}
        className={pageActionClass(primary, danger)}
        style={style}
      >
        {children}
      </a>
    );
  return (
    <Link
      href={href}
      data-testid={testId}
      className={pageActionClass(primary, danger)}
      style={style}
    >
      {children}
    </Link>
  );
}

/**
 * A settings screen: breadcrumb · title · one sentence · actions, then its
 * blocks 14 px apart, then the slot the save bar lands in.
 */
export function SettingsPage({
  home,
  crumb,
  title,
  lead,
  actions,
  children,
  testId,
}: {
  /** "Settings" — the first crumb, back to the overview. */
  home: string;
  crumb: string;
  title: string;
  lead?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      data-screen-label={`Settings — ${title}`}
      style={{ display: "flex", flexDirection: "column", gap: 14, animation: RISE }}
    >
      <div style={{ display: "flex", alignItems: "flex-end", gap: 14, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 320px", minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              color: "var(--ink-3)",
            }}
          >
            <Link
              href="/app/settings"
              className="oi-hover-edge-ink"
              style={{ color: "inherit", textDecoration: "none", cursor: "pointer" }}
            >
              {home}
            </Link>
            <span>/</span>
            <span>{crumb}</span>
          </div>
          <h1
            style={{
              margin: "3px 0 0",
              fontFamily: "var(--title)",
              fontSize: 24,
              fontWeight: 600,
              letterSpacing: "-.02em",
              lineHeight: 1.15,
            }}
          >
            {title}
          </h1>
          {lead && (
            <p
              style={{
                margin: "5px 0 0",
                fontSize: 13.5,
                lineHeight: 1.55,
                color: "var(--ink-2)",
                maxWidth: 660,
                textWrap: "pretty",
              }}
            >
              {lead}
            </p>
          )}
        </div>
        {actions && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{actions}</div>}
      </div>
      {children}
      <div data-savebar-slot="" style={{ display: "contents" }} />
    </div>
  );
}

/* ---------- Form card ---------- */

function CardHead({
  title,
  hint,
  padding = "13px 18px",
}: {
  title: ReactNode;
  hint?: ReactNode;
  padding?: string;
}) {
  return (
    <div style={{ padding }}>
      <div style={{ fontSize: 14, fontWeight: 600 }}>{title}</div>
      {hint && (
        <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 2, lineHeight: 1.5 }}>
          {hint}
        </div>
      )}
    </div>
  );
}

/** A card of rows: label and help on the left, the control on the right. */
export function FormCard({
  title,
  hint,
  children,
  testId,
  id,
}: {
  title: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  testId?: string;
  id?: string;
}) {
  return (
    <section id={id} data-testid={testId} style={cardStyle}>
      <CardHead title={title} hint={hint} />
      {children}
    </section>
  );
}

export function Row({
  label,
  help,
  children,
  testId,
  wide,
}: {
  label: ReactNode;
  help?: ReactNode;
  /** The control(s), right-aligned in a 360 px column. */
  children?: ReactNode;
  testId?: string;
  /** A control that needs more than the 360 px column (a chip list, a textarea). */
  wide?: boolean;
}) {
  return (
    <div
      data-testid={testId}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "12px 18px",
        borderTop: "1px solid var(--line-2)",
        flexWrap: "wrap",
      }}
    >
      <div style={{ flex: "1 1 220px", minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 500 }}>{label}</div>
        {help && (
          <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 1, lineHeight: 1.45 }}>
            {help}
          </div>
        )}
      </div>
      <div
        style={{
          flex: wide ? "1 1 420px" : "0 1 360px",
          minWidth: 180,
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "center",
          gap: 8,
        }}
      >
        {children}
      </div>
    </div>
  );
}

/** Input and select of a form row — 34 px, radius 9. Pair with className="oi-field". */
export function fieldStyle(mono?: boolean): CSSProperties {
  return {
    width: "100%",
    height: 34,
    border: "1px solid var(--line)",
    borderRadius: 9,
    padding: "0 11px",
    fontSize: 13,
    fontFamily: mono ? "var(--mono)" : "inherit",
    background: "var(--panel)",
    color: "var(--ink)",
    outline: "none",
  };
}

export const selectStyle: CSSProperties = { ...fieldStyle(), padding: "0 9px" };

/** A value that is read, not edited: the slug, the provider, the redaction applied. */
export function ReadOnly({
  children,
  mono,
  testId,
}: {
  children: ReactNode;
  mono?: boolean;
  testId?: string;
}) {
  return (
    <span
      data-testid={testId}
      style={{
        display: "flex",
        alignItems: "center",
        width: "100%",
        minHeight: 34,
        padding: "0 11px",
        borderRadius: 9,
        background: "var(--sunk)",
        fontSize: 12.5,
        fontFamily: mono ? "var(--mono)" : "inherit",
        color: "var(--ink-2)",
      }}
    >
      {children}
    </span>
  );
}

/** The button of a form row — "Rotate…", "Delete…". */
export function rowButtonStyle(danger?: boolean): CSSProperties {
  return {
    height: 32,
    padding: "0 13px",
    border: "1px solid var(--line)",
    borderRadius: 9,
    background: "var(--panel)",
    display: "flex",
    alignItems: "center",
    fontSize: 12.5,
    fontWeight: 600,
    color: danger ? "var(--dang)" : "var(--ink)",
    cursor: "pointer",
    whiteSpace: "nowrap",
    textDecoration: "none",
    fontFamily: "inherit",
  };
}

/* ---------- List card ---------- */

/** The button at the head of a list card — "+ Application", "Open Slack & Teams". */
export const listActionStyle: CSSProperties = {
  height: 32,
  padding: "0 13px",
  border: "1px solid var(--line)",
  borderRadius: 9,
  background: "var(--panel)",
  display: "flex",
  alignItems: "center",
  fontSize: 12.5,
  fontWeight: 600,
  cursor: "pointer",
  whiteSpace: "nowrap",
  color: "var(--ink)",
  textDecoration: "none",
  fontFamily: "inherit",
};

/** A list of objects on the row template; `action` sits at the right of its head. */
export function ListCard({
  title,
  hint,
  action,
  foot,
  children,
  testId,
  id,
}: {
  title?: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  foot?: ReactNode;
  children?: ReactNode;
  testId?: string;
  id?: string;
}) {
  return (
    <section id={id} data-testid={testId} style={cardStyle}>
      {(title || action) && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "13px 18px",
            flexWrap: "wrap",
          }}
        >
          <div style={{ flex: "1 1 240px", minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{title}</div>
            {hint && (
              <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 2, lineHeight: 1.5 }}>
                {hint}
              </div>
            )}
          </div>
          {action}
        </div>
      )}
      {children}
      {foot && <CardFoot>{foot}</CardFoot>}
    </section>
  );
}

export function CardFoot({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        padding: "10px 18px",
        borderTop: "1px solid var(--line-2)",
        fontSize: 12,
        color: "var(--ink-3)",
        lineHeight: 1.5,
        background: "var(--sunk)",
      }}
    >
      {children}
    </div>
  );
}

/** The button at the end of a list row — "Edit", "Revoke", "Send test". */
export function itemButtonStyle(ink: "ink" | "brand" | "dang" = "ink"): CSSProperties {
  return {
    height: 28,
    padding: "0 11px",
    border: "1px solid var(--line)",
    borderRadius: 8,
    background: "var(--panel)",
    display: "flex",
    alignItems: "center",
    fontSize: 12,
    fontWeight: 600,
    color: ink === "brand" ? "var(--brand)" : ink === "dang" ? "var(--dang)" : "var(--ink)",
    cursor: "pointer",
    whiteSpace: "nowrap",
    textDecoration: "none",
    fontFamily: "inherit",
  };
}

export function ItemLink({
  href,
  ink,
  children,
  testId,
}: {
  href: string;
  ink?: "ink" | "brand" | "dang";
  children: ReactNode;
  testId?: string;
}) {
  return (
    <Link href={href} data-testid={testId} className="oi-hover" style={itemButtonStyle(ink)}>
      {children}
    </Link>
  );
}

export type ChipSpec = { label: ReactNode; tone?: Tone; testId?: string };

export function Chip({
  tone = "mute",
  children,
  testId,
}: {
  tone?: Tone;
  children: ReactNode;
  testId?: string;
}) {
  const t = TONES[tone];
  return (
    <span
      data-testid={testId}
      style={{
        fontSize: 11,
        fontWeight: 600,
        borderRadius: 999,
        padding: "2px 9px",
        background: t.bg,
        color: t.ink,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

/**
 * One object on the row template. Everything but the title is optional; the
 * row turns into a link when `href` is given.
 */
export function ListItem({
  n,
  glyph,
  dot,
  title,
  titleMono,
  titleWeight = 600,
  sub,
  chips,
  right,
  button,
  href,
  muted,
  testId,
  data,
}: {
  /** A position, in a 22 px numbered square. */
  n?: ReactNode;
  /** A monochrome glyph ("Sl", "GH") or initials, in a 30 px square. */
  glyph?: { text: string; bg?: string; ink?: string };
  /** A 9 px coloured dot — a severity's colour, a state. */
  dot?: string;
  title: ReactNode;
  titleMono?: boolean;
  titleWeight?: number;
  sub?: ReactNode;
  chips?: ChipSpec[];
  right?: ReactNode;
  /** The row's one button (or a small cluster), already built. */
  button?: ReactNode;
  href?: string;
  muted?: boolean;
  testId?: string;
  /** Extra data-* attributes, for tests that find a row by its object. */
  data?: Record<string, string>;
}) {
  const style: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "11px 18px",
    borderTop: "1px solid var(--line-2)",
    cursor: href ? "pointer" : "default",
    background: "transparent",
    flexWrap: "wrap",
    opacity: muted ? 0.6 : 1,
    color: "inherit",
    textDecoration: "none",
  };
  const dataAttrs = Object.fromEntries(
    Object.entries(data ?? {}).map(([k, v]) => [`data-${k}`, v]),
  );
  const body = (
    <>
      {n !== undefined && (
        <span
          style={{
            width: 22,
            height: 22,
            borderRadius: 7,
            background: "var(--sunk)",
            display: "grid",
            placeItems: "center",
            fontFamily: "var(--mono)",
            fontSize: 11,
            fontWeight: 600,
            color: "var(--ink-2)",
            flex: "none",
          }}
        >
          {n}
        </span>
      )}
      {glyph && (
        <span
          aria-hidden
          style={{
            width: 30,
            height: 30,
            borderRadius: 8,
            background: glyph.bg ?? "var(--sunk)",
            color: glyph.ink ?? "var(--ink)",
            display: "grid",
            placeItems: "center",
            fontSize: 11,
            fontWeight: 700,
            flex: "none",
            letterSpacing: "-.02em",
          }}
        >
          {glyph.text}
        </span>
      )}
      {dot && (
        <span
          aria-hidden
          style={{ width: 9, height: 9, borderRadius: "50%", background: dot, flex: "none" }}
        />
      )}
      <div style={{ flex: "1 1 240px", minWidth: 0 }}>
        <div
          style={{
            fontSize: 13.5,
            fontWeight: titleWeight,
            fontFamily: titleMono ? "var(--mono)" : "inherit",
            lineHeight: 1.45,
            overflowWrap: "anywhere",
          }}
        >
          {title}
        </div>
        {sub && (
          <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 1, lineHeight: 1.45 }}>
            {sub}
          </div>
        )}
      </div>
      {chips && chips.length > 0 && (
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
          {chips.map((c, i) => (
            <Chip key={i} tone={c.tone} testId={c.testId}>
              {c.label}
            </Chip>
          ))}
        </div>
      )}
      {right && (
        <span style={{ fontSize: 12, color: "var(--ink-3)", whiteSpace: "nowrap" }}>{right}</span>
      )}
      {button}
    </>
  );
  if (href)
    return (
      <Link href={href} data-testid={testId} {...dataAttrs} className="oi-hover" style={style}>
        {body}
      </Link>
    );
  return (
    <div data-testid={testId} {...dataAttrs} className="oi-hover" style={style}>
      {body}
    </div>
  );
}

/* ---------- Filter chips ---------- */

export function filterChipStyle(active: boolean): CSSProperties {
  return {
    height: 30,
    padding: "0 12px",
    borderRadius: 999,
    border: `1px solid ${active ? "var(--brand-b)" : "var(--line)"}`,
    background: active ? "var(--brand-t)" : "var(--panel)",
    color: active ? "var(--brand)" : "var(--ink-2)",
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12.5,
    fontWeight: 600,
    cursor: "pointer",
    whiteSpace: "nowrap",
    textDecoration: "none",
    fontFamily: "inherit",
  };
}

export function FilterCount({ children }: { children: ReactNode }) {
  return (
    <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, opacity: 0.7 }}>{children}</span>
  );
}

/** Filter chips that navigate (`?area=Atlas`) — the server re-renders the list. */
export function FilterLinks({
  items,
  testId,
}: {
  items: Array<{
    key: string;
    label: ReactNode;
    count?: number | string;
    href: string;
    active: boolean;
  }>;
  testId?: string;
}) {
  return (
    <div data-testid={testId} style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {items.map((f) => (
        <Link
          key={f.key}
          href={f.href}
          scroll={false}
          data-filter={f.key}
          aria-current={f.active ? "true" : undefined}
          style={filterChipStyle(f.active)}
        >
          {f.label}
          {f.count !== undefined && <FilterCount>{f.count}</FilterCount>}
        </Link>
      ))}
    </div>
  );
}

/* ---------- Figures ---------- */

export function Stats({
  items,
  testId,
}: {
  items: Array<{ label: ReactNode; value: ReactNode; sub?: ReactNode; ink?: string }>;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))",
        gap: 1,
        background: "var(--line)",
        border: "1px solid var(--line)",
        borderRadius: "var(--radius-card)",
        overflow: "hidden",
      }}
    >
      {items.map((s, i) => (
        <div key={i} style={{ background: "var(--panel)", padding: "12px 16px" }}>
          <div
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: ".08em",
              textTransform: "uppercase",
              color: "var(--ink-3)",
            }}
          >
            {s.label}
          </div>
          <div
            style={{ fontSize: 17, fontWeight: 600, marginTop: 3, color: s.ink ?? "var(--ink)" }}
          >
            {s.value}
          </div>
          {s.sub && <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{s.sub}</div>}
        </div>
      ))}
    </div>
  );
}

/* ---------- Honest states and notes ---------- */

/** "Unavailable on this instance" + the reason, and the line that switches it on. */
export function Unavailable({
  title,
  text,
  code,
  testId = "settings-unavailable",
}: {
  title: ReactNode;
  text: ReactNode;
  code?: string;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      style={{
        border: "1.5px dashed var(--line)",
        borderRadius: "var(--radius-card)",
        background: "var(--panel)",
        padding: "22px 24px",
        display: "flex",
        gap: 16,
        alignItems: "flex-start",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 38,
          height: 38,
          borderRadius: 11,
          background: "var(--wait-t)",
          color: "var(--wait)",
          display: "grid",
          placeItems: "center",
          fontWeight: 700,
          fontSize: 16,
          flex: "none",
        }}
      >
        !
      </span>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 7 }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.6, maxWidth: 640 }}>
          {text}
        </div>
        {code && (
          <code
            style={{
              alignSelf: "flex-start",
              fontFamily: "var(--mono)",
              fontSize: 12,
              background: "var(--sunk)",
              borderRadius: 8,
              padding: "7px 11px",
              color: "var(--ink-2)",
            }}
          >
            {code}
          </code>
        )}
      </div>
    </div>
  );
}

/** A tinted line under a block: the rule a reader needs before acting. */
export function Note({
  tone,
  children,
  testId,
}: {
  tone?: Tone;
  children: ReactNode;
  testId?: string;
}) {
  const t = tone ? TONES[tone] : null;
  return (
    <div
      data-testid={testId}
      role={tone === "dang" ? "alert" : undefined}
      style={{
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
        background: t ? t.bg : "var(--sunk)",
        borderRadius: 12,
        padding: "11px 14px",
        fontSize: 12.5,
        lineHeight: 1.55,
        color: t ? t.ink : "var(--ink-2)",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: t ? t.ink : "var(--brand)",
          marginTop: 7,
          flex: "none",
        }}
      />
      <span style={{ minWidth: 0 }}>{children}</span>
    </div>
  );
}

/* ---------- Plain card (bespoke blocks: brand, hours, lifecycle) ---------- */

export function Card({
  children,
  padding = "16px 18px",
  gap = 12,
  testId,
  style,
}: {
  children: ReactNode;
  padding?: string;
  gap?: number;
  testId?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      data-testid={testId}
      style={{
        ...cardStyle,
        overflow: "visible",
        padding,
        display: "flex",
        flexDirection: "column",
        gap,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** The header of a card that holds code or a matrix: title, hint, 10 px under. */
export function BlockHead({ title, hint }: { title: ReactNode; hint?: ReactNode }) {
  return <CardHead title={title} hint={hint} padding="13px 18px 10px" />;
}
