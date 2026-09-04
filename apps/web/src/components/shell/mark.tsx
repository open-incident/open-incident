/** The product mark — three strokes, the design's 48-unit glyph. */
export function ProductMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" style={{ flex: "none" }} aria-hidden="true">
      <g stroke="var(--brand)" strokeWidth="8" strokeLinecap="round" fill="none">
        <path d="M24 8v32" />
        <path d="M10.1 16l27.8 16" />
        <path d="M37.9 16L10.1 32" />
      </g>
    </svg>
  );
}

/** "Open*Incident" — Bricolage 16/600, the asterisk in brand. */
export function Wordmark() {
  return (
    <div
      style={{
        fontFamily: "var(--font-title)",
        fontSize: 16,
        fontWeight: 600,
        letterSpacing: "-.015em",
        whiteSpace: "nowrap",
      }}
    >
      Open<span style={{ color: "var(--brand)" }}>*</span>Incident
    </div>
  );
}

/** A workspace's square — its logo when it has one, its initial on its accent otherwise. */
export function WorkspaceMark({
  name,
  accent,
  logoUrl,
  size = 40,
}: {
  name: string;
  accent?: string;
  logoUrl?: string;
  size?: number;
}) {
  if (logoUrl) {
    // Plain <img>s (the asset is served by the product, not next/image); two files,
    // one shown — the dark variant, or the light one again, under the dark theme.
    const style: React.CSSProperties = {
      width: size,
      height: size,
      borderRadius: Math.round(size * 0.275),
      objectFit: "contain",
    };
    const dark = `${logoUrl}${logoUrl.includes("?") ? "&" : "?"}variant=dark`;
    return (
      <>
        <img src={logoUrl} alt="" className="oi-logo-light" style={style} />
        <img src={dark} alt="" className="oi-logo-dark" style={style} />
      </>
    );
  }
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.275),
        background: accent || "var(--brand)",
        color: "#fff",
        display: "grid",
        placeItems: "center",
        fontWeight: 700,
        fontSize: Math.round(size * 0.375),
        flex: "none",
      }}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}
