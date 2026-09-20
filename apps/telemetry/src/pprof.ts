/**
 * pprof into samples a flamegraph can be drawn from.
 *
 * pprof is the format every runtime already emits — Go's `net/http/pprof`, the
 * JVM's async-profiler, Python's py-spy, Rust's pprof crate — so accepting it
 * is what makes "point your profiler at this" true without an agent of ours in
 * the way.
 *
 * The decode is three joins the format leaves to the reader. A sample holds
 * location ids; a location holds one or more lines (several when the compiler
 * inlined); a line holds a function id; a function holds indices into the
 * string table. Following all three is what turns a bag of integers into
 * `net/http.(*conn).serve server.go:2092`.
 */
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import protobuf from "protobufjs";

const PROTO = join(dirname(fileURLToPath(import.meta.url)), "..", "proto", "pprof.proto");
const root = protobuf.parse(readFileSync(PROTO, "utf8"), { keepCase: true }).root;
const Profile = root.lookupType("perftools.profiles.Profile");

export class PprofError extends Error {}

/** The kinds the product stores, and what anything else is mapped onto. */
export const PROFILE_TYPES = [
  "cpu",
  "wall",
  "alloc_space",
  "alloc_objects",
  "inuse_space",
  "inuse_objects",
  "goroutines",
  "mutex",
  "block",
] as const;
export type ProfileType = (typeof PROFILE_TYPES)[number];

export type ProfileSample = {
  /** Frames leaf first, each `function file:line`. */
  frames: string[];
  value: number;
  labels: Record<string, string>;
};

export type ProfileDecode = {
  type: ProfileType;
  unit: string;
  periodNs: number;
  /** When the profile was taken, from the profile itself when it says. */
  timeNanos: number;
  durationNanos: number;
  samples: ProfileSample[];
  symbolized: boolean;
};

/** A ceiling on what one upload may unpack to, checked before it is decoded. */
export const MAX_PROFILE_BYTES = 32 * 1024 * 1024;

/**
 * The product's name for what was measured.
 *
 * pprof's own type strings differ between runtimes — Go says `cpu` and
 * `alloc_space`, async-profiler says `cpu` and `alloc`, py-spy says `wall`.
 * Mapping them onto one vocabulary is what lets a screen offer a list of types
 * rather than whatever this particular binary happened to call it.
 */
export function profileTypeOf(type: string, unit: string): ProfileType {
  const t = type.toLowerCase();
  if (t.includes("alloc") && unit.includes("byte")) return "alloc_space";
  if (t.includes("alloc")) return "alloc_objects";
  if (t.includes("inuse") && unit.includes("byte")) return "inuse_space";
  if (t.includes("inuse")) return "inuse_objects";
  if (t.includes("goroutine") || t.includes("thread")) return "goroutines";
  if (t.includes("mutex") || t.includes("contention") || t.includes("lock")) return "mutex";
  if (t.includes("block")) return "block";
  if (t.includes("wall") || t.includes("itimer") || t.includes("real")) return "wall";
  return "cpu";
}

/**
 * Which of a pprof's value columns are worth keeping, and as what.
 *
 * A pprof is not one profile. A Go heap profile carries four — allocated
 * objects, allocated bytes, live objects, live bytes — and a Go CPU profile
 * carries two, the sample count and the nanoseconds. Picking one and calling
 * it "the" profile is what made a heap upload draw an empty flamegraph here:
 * the last column is `inuse_space`, and on a service that frees what it
 * allocates that column is entirely zero while the two beside it hold
 * everything interesting.
 *
 * So every column becomes its own profile. Two rules keep that from producing
 * duplicates: columns that map to the same kind are represented by the one
 * measuring a quantity rather than counting samples, and a column that is zero
 * all the way down is dropped — it has nothing to draw.
 */
function columnsOf(
  types: Array<{ type?: number; unit?: number }>,
  str: (i: number | undefined) => string,
): Array<{ at: number; type: ProfileType; unit: string }> {
  const best = new Map<ProfileType, { at: number; type: ProfileType; unit: string }>();
  types.forEach((t, at) => {
    const unit = str(t.unit);
    const type = profileTypeOf(str(t.type), unit);
    const held = best.get(type);
    // `count` loses to anything else: "how many samples mentioned this path"
    // and "how many nanoseconds it took" are the same shape and only the
    // second makes a flamegraph whose widths mean something.
    if (!held || (held.unit === "count" && unit !== "count")) best.set(type, { at, type, unit });
  });
  return [...best.values()];
}

export function decodePprof(body: Buffer, hint?: string): ProfileDecode[] {
  // Gzip is not part of pprof, it is the convention: Go writes it gzipped and
  // so does everything that imitates Go. A body that is not gzipped is read as
  // it is rather than refused, because a `curl --data-binary` of an already
  // unpacked profile is a reasonable thing for somebody to try.
  let raw = body;
  if (body.length > 2 && body[0] === 0x1f && body[1] === 0x8b) {
    raw = gunzipSync(body, { maxOutputLength: MAX_PROFILE_BYTES });
  }
  if (raw.length > MAX_PROFILE_BYTES) {
    throw new PprofError(`this profile unpacks to ${raw.length} bytes, above the ceiling`);
  }

  const profile = Profile.decode(raw) as unknown as {
    sample_type?: Array<{ type?: number; unit?: number }>;
    sample?: Array<{
      location_id?: Array<number | { toNumber(): number }>;
      value?: Array<number | { toNumber(): number }>;
      label?: Array<{ key?: number; str?: number; num?: number | { toNumber(): number } }>;
    }>;
    location?: Array<{
      id?: number | { toNumber(): number };
      address?: number | { toNumber(): number };
      line?: Array<{ function_id?: number | { toNumber(): number }; line?: number }>;
    }>;
    function?: Array<{
      id?: number | { toNumber(): number };
      name?: number;
      filename?: number;
    }>;
    string_table?: string[];
    time_nanos?: number | { toNumber(): number };
    duration_nanos?: number | { toNumber(): number };
    period?: number | { toNumber(): number };
    period_type?: { type?: number; unit?: number };
    default_sample_type?: number | { toNumber(): number };
  };

  const strings = profile.string_table ?? [];
  const str = (i: number | undefined): string => strings[Number(i ?? 0)] ?? "";

  const columns = columnsOf(profile.sample_type ?? [], str);
  if (columns.length === 0) throw new PprofError("this profile declares no sample type");

  // The two lookup tables, built once. A profile of a large binary has tens of
  // thousands of locations and every sample refers to a handful of them.
  const functions = new Map<number, { name: string; file: string }>();
  for (const f of profile.function ?? []) {
    functions.set(toNumber(f.id), { name: str(f.name), file: str(f.filename) });
  }
  const locations = new Map<number, { frames: string[]; resolved: boolean }>();
  for (const l of profile.location ?? []) {
    const frames: string[] = [];
    for (const line of l.line ?? []) {
      const fn = functions.get(toNumber(line.function_id));
      if (!fn) continue;
      const file = fn.file ? ` ${short(fn.file)}:${Number(line.line ?? 0)}` : "";
      frames.push(`${fn.name || "?"}${file}`);
    }
    if (frames.length === 0) {
      // No line information: the profiler sent an address it could not
      // resolve. Kept as the address rather than dropped — a flamegraph with a
      // hexadecimal block still tells you how wide it is.
      const address = toNumber(l.address);
      frames.push(address ? `0x${address.toString(16)}` : "?");
    }
    locations.set(toNumber(l.id), { frames, resolved: (l.line ?? []).length > 0 });
  }

  let unresolved = 0;
  let resolved = 0;

  // The frames of a sample are the same whatever column is being read, so they
  // are resolved once and every column reuses them. On a large binary this is
  // the difference between one pass and four.
  const prepared: Array<{ frames: string[]; values: number[]; labels: Record<string, string> }> =
    [];
  for (const s of profile.sample ?? []) {
    const frames: string[] = [];
    for (const id of s.location_id ?? []) {
      const location = locations.get(toNumber(id));
      if (!location) continue;
      if (location.resolved) resolved++;
      else unresolved++;
      frames.push(...location.frames);
    }
    if (frames.length === 0) continue;

    const labels: Record<string, string> = {};
    for (const l of s.label ?? []) {
      const key = str(l.key);
      if (!key) continue;
      labels[key] = l.str ? str(l.str) : String(toNumber(l.num));
    }
    prepared.push({ frames, values: (s.value ?? []).map(toNumber), labels });
  }

  // Called symbolised when most frames resolved: a handful of addresses in an
  // otherwise named profile is normal (the runtime's own assembly), and
  // calling the whole thing unsymbolised for them would cry wolf.
  const symbolized = resolved >= unresolved;
  const out: ProfileDecode[] = [];

  for (const column of columns) {
    const samples: ProfileSample[] = [];
    for (const p of prepared) {
      const value = p.values[column.at] ?? 0;
      // A sample worth nothing is not a sample: profilers emit call paths that
      // cost nothing in this particular column, and they are zero-width blocks
      // in every flamegraph.
      if (value <= 0) continue;
      samples.push({ frames: p.frames, value, labels: p.labels });
    }
    // A column that is zero all the way down is a measurement this profile did
    // not make. Storing it would put an empty type in the screen's picker.
    if (samples.length === 0) continue;
    out.push({
      // The hint, when the caller has one, names what the *upload* was about —
      // a Pyroscope agent says so in the URL. It only overrides a single-column
      // profile: on a heap profile with four, the columns know better.
      type: hint && columns.length === 1 ? profileTypeOf(hint, column.unit) : column.type,
      unit: column.unit,
      periodNs: toNumber(profile.period),
      timeNanos: toNumber(profile.time_nanos),
      durationNanos: toNumber(profile.duration_nanos),
      samples,
      symbolized,
    });
  }

  if (out.length === 0) throw new PprofError("this profile has no sample with a value above zero");
  return out;
}

/**
 * The stack's identity: FNV-1a over the frames, joined.
 *
 * Sixty-four bits because that is the column's width and what pprof's own
 * tooling uses. A collision merges two call paths into one flamegraph block —
 * rare enough to accept at this width, and worth saying out loud rather than
 * discovering.
 */
export function stackId(frames: string[]): string {
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (const ch of frames.join("\n")) {
    h = ((h ^ BigInt(ch.charCodeAt(0))) * prime) & mask;
  }
  return h.toString();
}

/** A path, shortened to what identifies it on a flamegraph's one line. */
function short(file: string): string {
  const parts = file.split("/");
  return parts.length <= 2 ? file : parts.slice(-2).join("/");
}

function toNumber(v: unknown): number {
  if (v === undefined || v === null) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "string") return Number(v);
  const long = v as { toNumber?: () => number };
  return typeof long.toNumber === "function" ? long.toNumber() : 0;
}
