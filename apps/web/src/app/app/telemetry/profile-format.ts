/**
 * How a profile's numbers are written, for both sides of the boundary.
 *
 * In its own module with no directive, because the flamegraph is a client
 * component and the table around it is a server one, and a function exported
 * from a `"use client"` file cannot be called on the server — only rendered.
 * Duplicating it would be two places for "nanoseconds become milliseconds" to
 * disagree.
 */

/** Nanoseconds and bytes are the two units a profile carries; the rest counts. */
export function format(value: number, unit: string): string {
  if (unit.startsWith("nano")) {
    if (value >= 1e9) return `${(value / 1e9).toFixed(2)} s`;
    if (value >= 1e6) return `${(value / 1e6).toFixed(0)} ms`;
    return `${(value / 1e3).toFixed(0)} µs`;
  }
  if (unit.startsWith("byte")) {
    if (value >= 1 << 30) return `${(value / (1 << 30)).toFixed(2)} GiB`;
    if (value >= 1 << 20) return `${(value / (1 << 20)).toFixed(1)} MiB`;
    if (value >= 1 << 10) return `${(value / (1 << 10)).toFixed(0)} KiB`;
    return `${value} B`;
  }
  return value.toLocaleString();
}
