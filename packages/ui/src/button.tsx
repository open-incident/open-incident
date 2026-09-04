import type { ButtonHTMLAttributes, CSSProperties } from "react";
import { cn } from "./index";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** solid = the one primary action of a screen; ghost = everything else; danger = destructive. */
  variant?: "solid" | "ghost" | "danger";
  size?: "md" | "sm";
};

const BASE: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  borderRadius: 8,
  fontWeight: 600,
  whiteSpace: "nowrap",
  cursor: "pointer",
  border: "1px solid transparent",
};

const VARIANTS: Record<NonNullable<ButtonProps["variant"]>, CSSProperties> = {
  solid: { background: "var(--brand)", color: "var(--on-brand)", borderColor: "var(--brand)" },
  ghost: { background: "var(--panel)", color: "var(--ink)", borderColor: "var(--line)" },
  danger: { background: "var(--dang-t)", color: "var(--dang)", borderColor: "var(--dang-t)" },
};

const SIZES: Record<NonNullable<ButtonProps["size"]>, CSSProperties> = {
  md: { height: 36, padding: "0 14px", fontSize: 13.5 },
  sm: { height: 30, padding: "0 10px", fontSize: 12.5 },
};

/**
 * The product's button. Solid buttons have no hover — a filled control that
 * shifts under the cursor reads as a second state it does not have. Ghost
 * buttons take the `oi-hover` reaction from the app stylesheet.
 */
export function Button({ variant = "ghost", size = "md", className, style, ...rest }: ButtonProps) {
  return (
    <button
      type={rest.type ?? "button"}
      className={cn(variant === "ghost" && "oi-hover", "oi-focus", className)}
      style={{ ...BASE, ...VARIANTS[variant], ...SIZES[size], ...style }}
      {...rest}
    />
  );
}
