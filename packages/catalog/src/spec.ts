/**
 * The catalog's exchange format — what the importer sends, what the API
 * accepts, what a CSV becomes. One shape for every source, validated once.
 *
 * A bundle declares types (with their attribute schemas) and entries. Nothing
 * here is stored as-is: `apply.ts` reconciles it with the workspace.
 */

export type AttributeKind = "text" | "link" | "member_list" | "entry" | "select";

export const ATTRIBUTE_KINDS: readonly AttributeKind[] = [
  "text",
  "link",
  "select",
  "entry",
  "member_list",
];

export type AttributeSpec = {
  key: string;
  label: string;
  type: AttributeKind;
  /** For `entry`: the key of the referenced type. */
  refTypeKey?: string;
  /** For `select`: the accepted values. */
  options?: string[];
};

export type TypeSpec = {
  key: string;
  name: string;
  description?: string | null;
  attributes: AttributeSpec[];
};

export type EntrySpec = {
  /** Key of the type the entry belongs to. */
  type: string;
  /** An existing entry to update (the UI's edit form); absent for imports. */
  id?: string;
  name: string;
  description?: string | null;
  external_id?: string | null;
  /**
   * Values keyed by attribute key. `entry` references accept an id, an
   * external_id or a name of the referenced type; `member_list` accepts emails.
   */
  attributes?: Record<string, unknown>;
};

export type Bundle = { types: TypeSpec[]; entries: EntrySpec[] };

/** A type or attribute key: what the code, the API and the CSV headers use. */
export const KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;

/** Keys the product reasons about; they cannot be deleted, only extended. */
export const CORE_TYPE_KEYS = ["team", "service", "environment"] as const;

/** "Payments squad" → "payments_squad": the key suggested from a label. */
export function keyify(label: string): string {
  const base = label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40)
    .replace(/_+$/g, "");
  if (!base) return "";
  return /^[a-z]/.test(base) ? base : `t_${base}`.slice(0, 40);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v.trim() : undefined;
}

/**
 * Validates attribute definitions. Errors are collected, not thrown, and name
 * their path — a bundle with 300 entries deserves the full list at once.
 */
export function parseAttributes(input: unknown, path: string, errors: string[]): AttributeSpec[] {
  if (input === undefined) return [];
  if (!Array.isArray(input)) {
    errors.push(`${path}: expected an array of attributes`);
    return [];
  }
  const out: AttributeSpec[] = [];
  const seen = new Set<string>();
  input.forEach((raw, i) => {
    const at = `${path}[${i}]`;
    if (!isRecord(raw)) return void errors.push(`${at}: expected an object`);
    const label = str(raw.label) ?? "";
    const key = str(raw.key) ?? keyify(label);
    const type = str(raw.type) ?? "text";
    if (!KEY_PATTERN.test(key)) return void errors.push(`${at}.key: "${key}" is not a valid key`);
    if (seen.has(key)) return void errors.push(`${at}.key: "${key}" is declared twice`);
    if (!label) return void errors.push(`${at}.label: required`);
    if (!(ATTRIBUTE_KINDS as readonly string[]).includes(type))
      return void errors.push(`${at}.type: "${type}" is not one of ${ATTRIBUTE_KINDS.join(", ")}`);
    const def: AttributeSpec = { key, label: label.slice(0, 80), type: type as AttributeKind };
    if (def.type === "entry") {
      const ref = str(raw.refTypeKey ?? raw.ref_type ?? raw.ref);
      if (!ref || !KEY_PATTERN.test(ref))
        return void errors.push(`${at}.refTypeKey: an entry attribute names the referenced type`);
      def.refTypeKey = ref;
    }
    if (def.type === "select") {
      const options = Array.isArray(raw.options)
        ? raw.options.map((o) => String(o).trim()).filter(Boolean)
        : typeof raw.options === "string"
          ? raw.options
              .split(/[,|]/)
              .map((o) => o.trim())
              .filter(Boolean)
          : [];
      if (options.length === 0)
        return void errors.push(`${at}.options: a select attribute lists its values`);
      def.options = [...new Set(options)].slice(0, 50);
    }
    seen.add(key);
    out.push(def);
  });
  return out;
}

export function parseTypeSpec(raw: unknown, path: string, errors: string[]): TypeSpec | null {
  if (!isRecord(raw)) {
    errors.push(`${path}: expected an object`);
    return null;
  }
  const name = str(raw.name) ?? "";
  const key = str(raw.key) ?? keyify(name);
  if (!KEY_PATTERN.test(key)) {
    errors.push(`${path}.key: "${key}" is not a valid key`);
    return null;
  }
  if (name.length < 2) {
    errors.push(`${path}.name: required`);
    return null;
  }
  const description = str(raw.description);
  return {
    key,
    name: name.slice(0, 80),
    description: description ? description.slice(0, 500) : null,
    attributes: parseAttributes(raw.attributes, `${path}.attributes`, errors),
  };
}

export function parseEntrySpec(
  raw: unknown,
  path: string,
  errors: string[],
  defaultType?: string,
): EntrySpec | null {
  if (!isRecord(raw)) {
    errors.push(`${path}: expected an object`);
    return null;
  }
  const type = str(raw.type) ?? defaultType ?? "";
  const name = str(raw.name) ?? "";
  if (!KEY_PATTERN.test(type)) {
    errors.push(`${path}.type: "${type}" is not a valid type key`);
    return null;
  }
  if (!name) {
    errors.push(`${path}.name: required`);
    return null;
  }
  const externalId = str(raw.external_id ?? raw.externalId);
  const description = str(raw.description);
  const attributes = isRecord(raw.attributes) ? raw.attributes : {};
  const id = str(raw.id);
  return {
    type,
    ...(id ? { id } : {}),
    name: name.slice(0, 160),
    description: description ? description.slice(0, 500) : null,
    external_id: externalId ? externalId.slice(0, 200) : null,
    attributes,
  };
}

/** Validates a whole bundle; `errors` empty means every item parsed. */
export function parseBundle(input: unknown): { bundle: Bundle; errors: string[] } {
  const errors: string[] = [];
  const bundle: Bundle = { types: [], entries: [] };
  if (!isRecord(input))
    return { bundle, errors: ["bundle: expected an object { types, entries }"] };
  const types = input.types ?? [];
  const entries = input.entries ?? [];
  if (!Array.isArray(types)) errors.push("types: expected an array");
  else
    types.forEach((t, i) => {
      const spec = parseTypeSpec(t, `types[${i}]`, errors);
      if (spec) bundle.types.push(spec);
    });
  if (!Array.isArray(entries)) errors.push("entries: expected an array");
  else
    entries.forEach((e, i) => {
      const spec = parseEntrySpec(e, `entries[${i}]`, errors);
      if (spec) bundle.entries.push(spec);
    });
  return { bundle, errors };
}
