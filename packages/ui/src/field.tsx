import type {
  CSSProperties,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { cn } from "./index";

export type FieldProps = {
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
};

/** Label above the control, hint or error under it. */
export function Field({ label, hint, error, children }: FieldProps) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-2)" }}>{label}</span>
      {children}
      {error ? (
        <span style={{ fontSize: 12, color: "var(--dang)" }}>{error}</span>
      ) : hint ? (
        <span style={{ fontSize: 12, color: "var(--ink-3)" }}>{hint}</span>
      ) : null}
    </label>
  );
}

const CONTROL: CSSProperties = {
  height: 36,
  padding: "0 12px",
  borderRadius: 8,
  border: "1px solid var(--line)",
  background: "var(--panel)",
  color: "var(--ink)",
  fontSize: 13.5,
  width: "100%",
  outline: "none",
};

export function Input({ className, style, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn("oi-field", className)} style={{ ...CONTROL, ...style }} {...rest} />;
}

export function Select({ className, style, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn("oi-field", className)} style={{ ...CONTROL, ...style }} {...rest} />
  );
}

export function Textarea({
  className,
  style,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn("oi-field", className)}
      style={{
        ...CONTROL,
        height: "auto",
        minHeight: 96,
        padding: "10px 12px",
        resize: "vertical",
        ...style,
      }}
      {...rest}
    />
  );
}
