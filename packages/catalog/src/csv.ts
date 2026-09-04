/**
 * CSV in, entries out. RFC 4180: quoted fields, doubled quotes, CR LF, and
 * the BOM Excel likes to prepend. The header row names the columns: `name`,
 * `description`, `external_id`, then one column per attribute key.
 */
import { parseEntrySpec, type EntrySpec } from "./spec";

export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

export function toCsv(rows: string[][]): string {
  const cell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

/** The fixed columns; every other header is an attribute key. */
export const CSV_FIXED_COLUMNS = ["name", "description", "external_id"] as const;

/**
 * Turns a CSV into entries of one type. Attribute cells stay strings: the
 * resolution (select values, entry references, member emails) is the
 * upsert's job, where the type's schema is known.
 */
export function entriesFromCsv(
  text: string,
  typeKey: string,
): { entries: EntrySpec[]; errors: string[]; columns: string[] } {
  const rows = parseCsv(text);
  const errors: string[] = [];
  const header = (rows[0] ?? []).map((h) =>
    h
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_"),
  );
  if (header.length === 0) return { entries: [], errors: ["csv: empty file"], columns: [] };
  if (!header.includes("name"))
    return {
      entries: [],
      errors: ['csv: the header must include a "name" column'],
      columns: header,
    };
  const entries: EntrySpec[] = [];
  rows.slice(1).forEach((cells, i) => {
    const raw: Record<string, unknown> = { type: typeKey };
    const attributes: Record<string, unknown> = {};
    header.forEach((col, j) => {
      const value = (cells[j] ?? "").trim();
      if ((CSV_FIXED_COLUMNS as readonly string[]).includes(col)) raw[col] = value;
      else if (col && value !== "") attributes[col] = value;
    });
    raw.attributes = attributes;
    const spec = parseEntrySpec(raw, `row ${i + 2}`, errors, typeKey);
    if (spec) entries.push(spec);
  });
  return { entries, errors, columns: header };
}
