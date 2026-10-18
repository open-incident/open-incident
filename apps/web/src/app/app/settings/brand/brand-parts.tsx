"use client";

import { useActionState, useEffect, useRef, useState, type CSSProperties } from "react";
import { useT } from "@/i18n/client";
import { flash } from "@/components/settings/controls";
import { markChanged, type FormResult } from "@/components/settings/settings-form";
import { removeLogo, uploadLogo } from "./logo-actions";

/** The six accents the design offers; any hex can still be typed. */
export const SWATCHES = ["#B4552D", "#0B4A6F", "#0E7A58", "#7C3AED", "#C0342B", "#0D161C"];

/**
 * The accent: six swatches and the hex it stands for. Picking one writes the
 * hidden field the form saves and tells the form it changed; the preview
 * beside it follows the pick at once, before anything is saved.
 */
export function AccentPicker({ initial, label }: { initial: string; label: string }) {
  const [accent, setAccent] = useState(initial);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    document.documentElement.style.setProperty("--oi-brand-preview", accent);
    return () => {
      document.documentElement.style.removeProperty("--oi-brand-preview");
    };
  }, [accent]);
  const pick = (c: string) => {
    setAccent(c);
    if (input.current) {
      input.current.value = c;
      markChanged(input.current);
    }
  };
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      {SWATCHES.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={c}
          aria-pressed={c === accent.toUpperCase()}
          data-swatch={c}
          onClick={() => pick(c)}
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            background: c,
            cursor: "pointer",
            border: 0,
            padding: 0,
            boxShadow:
              c === accent.toUpperCase() ? `0 0 0 2px var(--panel), 0 0 0 4px ${c}` : "none",
          }}
        />
      ))}
      <span style={{ flex: 1 }} />
      <input
        ref={input}
        name="accentColor"
        defaultValue={initial}
        aria-label={label}
        data-testid="brand-accent"
        pattern="^#[0-9a-fA-F]{6}$"
        onChange={(e) => {
          const v = e.currentTarget.value.trim();
          if (/^#[0-9a-fA-F]{6}$/.test(v)) setAccent(v.toUpperCase());
        }}
        className="oi-field"
        style={{
          height: 30,
          width: 96,
          padding: "0 11px",
          border: "1px solid var(--line)",
          borderRadius: 8,
          display: "flex",
          alignItems: "center",
          fontFamily: "var(--mono)",
          fontSize: 12,
          background: "var(--panel)",
          outline: "none",
          textTransform: "uppercase",
        }}
      />
    </div>
  );
}

/** The accent as the preview reads it: the picked one while unsaved, else the saved one. */
export function accentVar(saved: string): string {
  return `var(--oi-brand-preview, ${saved})`;
}

/**
 * One logo tile — the light or the dark background. Upload picks a file and
 * sends it at once (nothing to save afterwards); the tile then shows the file
 * on its own background, as the status page will.
 */
export function LogoTile({
  variant,
  initial,
  saved,
  logoUrl,
  storage,
  canManage,
}: {
  variant: "light" | "dark";
  initial: string;
  saved: string;
  logoUrl: string | null;
  storage: boolean;
  canManage: boolean;
}) {
  const t = useT();
  const [state, action, pending] = useActionState<FormResult, FormData>(uploadLogo, null);
  const seen = useRef<FormResult>(null);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!state || state === seen.current) return;
    seen.current = state;
    flash(state.ok ? (state.message ?? t("settingsV2.saved")) : state.error);
    if (file.current) file.current.value = "";
  }, [state, t]);
  const dark = variant === "dark";
  const tile: CSSProperties = {
    border: "1.5px dashed var(--line)",
    borderRadius: 12,
    padding: 14,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 7,
    textAlign: "center",
    background: dark ? "var(--topbar-dark)" : undefined,
    color: dark ? "#fff" : undefined,
  };
  const src = logoUrl ? (dark ? `${logoUrl}&variant=dark` : logoUrl) : null;
  return (
    <form action={action} style={tile} data-testid={`logo-tile-${variant}`}>
      <input type="hidden" name="variant" value={variant} />
      {src ? (
        <img
          src={src}
          alt=""
          style={{ width: 44, height: 44, borderRadius: 12, objectFit: "contain" }}
        />
      ) : (
        <span
          aria-hidden
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            background: accentVar(saved),
            color: "#fff",
            display: "grid",
            placeItems: "center",
            fontWeight: 700,
            fontSize: 18,
          }}
        >
          {initial}
        </span>
      )}
      <span style={{ fontSize: 12.5, fontWeight: 600 }}>
        {dark ? t("settingsV2.brand.dark") : t("settingsV2.brand.light")}
      </span>
      <span
        style={{ fontSize: 11, color: dark ? undefined : "var(--ink-3)", opacity: dark ? 0.6 : 1 }}
      >
        {t("settingsV2.brand.formats")}
      </span>
      {storage && canManage && (
        <label
          className={dark ? undefined : "oi-hover"}
          style={{
            height: 28,
            padding: "0 11px",
            border: `1px solid ${dark ? "rgba(255,255,255,.25)" : "var(--line)"}`,
            borderRadius: 8,
            display: "flex",
            alignItems: "center",
            fontSize: 12,
            fontWeight: 600,
            cursor: pending ? "default" : "pointer",
            opacity: pending ? 0.7 : 1,
          }}
        >
          {pending ? t("settingsV2.brand.uploading") : t("settingsV2.brand.upload")}
          <input
            ref={file}
            type="file"
            name="logo"
            accept="image/svg+xml,image/png"
            data-testid={dark ? "logo-file-dark" : "logo-file"}
            disabled={pending}
            onChange={(e) => {
              if (e.currentTarget.files?.length) e.currentTarget.form?.requestSubmit();
            }}
            style={{ display: "none" }}
          />
        </label>
      )}
    </form>
  );
}

/** "Remove the logos" — back to the initial on the accent everywhere. */
export function RemoveLogos() {
  const t = useT();
  const [state, action, pending] = useActionState<FormResult, FormData>(removeLogo, null);
  const seen = useRef<FormResult>(null);
  useEffect(() => {
    if (!state || state === seen.current) return;
    seen.current = state;
    flash(state.ok ? (state.message ?? t("settingsV2.saved")) : state.error);
  }, [state, t]);
  return (
    <form action={action}>
      <button
        type="submit"
        disabled={pending}
        data-testid="logo-remove"
        className="oi-hover-dang"
        style={{
          height: 28,
          padding: "0 11px",
          border: "1px solid var(--line)",
          borderRadius: 8,
          background: "var(--panel)",
          fontSize: 12,
          fontWeight: 600,
          color: "var(--dang)",
          cursor: "pointer",
        }}
      >
        {t("settingsV2.brand.remove")}
      </button>
    </form>
  );
}
