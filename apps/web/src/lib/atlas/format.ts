/**
 * Euros and tokens the way the Atlas screens write them: "212 €", "0.94 €",
 * "6.4 M tokens" — locale digits, the symbol after the amount as the design
 * writes it. Owner: atlas-core.
 */
type Fmt = { decimal(n: number, digits?: number): string; number(n: number): string };

export function euros(fmt: Fmt, n: number): string {
  const v = Math.abs(n) >= 10 ? fmt.number(Math.round(n)) : fmt.decimal(n, 2);
  return `${v} €`;
}

export function tokens(fmt: Fmt, n: number): string {
  if (n >= 1_000_000) return `${fmt.decimal(n / 1_000_000, 1)} M`;
  if (n >= 1_000) return `${fmt.decimal(n / 1_000, 0)} k`;
  return fmt.number(n);
}
