/**
 * Reading profiles: a flamegraph, a table, and the difference between two.
 *
 * A flamegraph is not stored, it is computed. What the store holds is a bag of
 * (stack, value) pairs, and every view of it is a fold of that bag: the graph
 * folds stacks into a tree, the table folds them into one row per function,
 * and the diff folds two windows and subtracts. Storing a tree would fix one
 * of those three and make the other two a reconstruction.
 *
 * The diff is the reason to have profiles at all rather than a screenshot of
 * one. "It is slower than last week" is a sentence somebody says; "this
 * function went from 3 % to 41 % between these two releases" is the sentence
 * that ends the investigation.
 */
import { read } from "./query";

export { PROFILES, PROFILE_STACKS } from "./views";
import { PROFILES, PROFILE_STACKS } from "./views";

export type ProfileWindow = {
  service: string;
  type: string;
  from: Date;
  to: Date;
  environment?: string;
};

export type FlameNode = {
  name: string;
  /** The file and line this frame was first seen at, for the detail. */
  at: string;
  /** Everything that passed through this frame. */
  value: number;
  children: FlameNode[];
};

export type Flamegraph = {
  root: FlameNode;
  total: number;
  unit: string;
  /** Distinct call paths read, before pruning. */
  stacks: number;
  /** How much was folded away as too small to draw. */
  pruned: number;
};

/**
 * Below this share of the total, a frame is not drawn.
 *
 * A production profile has tens of thousands of distinct call paths and a
 * flamegraph of all of them is a smear one pixel wide per block: unreadable,
 * and several megabytes of markup. Half a per mille keeps everything a person
 * could click and folds the rest — and the amount folded is reported rather
 * than silently dropped, because "the widths do not add up" is the first thing
 * anybody notices.
 */
export const PRUNE_BELOW = 0.0005;

type StackRow = { frames: string[]; total: string; unit: string };

/**
 * The function a frame belongs to, without its line.
 *
 * Frames are stored as `name file:line` because the line is worth keeping —
 * it is what tells you *where* in a function the time went. But it is not the
 * unit anybody thinks in: a hot loop spread over four lines of assembly showed
 * up as four rows of ten per cent each, and the one fact a reader wanted —
 * that this function is a third of the profile — was nowhere on the screen.
 *
 * So the graph and the table fold by function, and the location is kept beside
 * it for the detail. The suffix is recognised by its shape (a space, then
 * something ending in `:digits`), which is narrow enough not to cut a C++
 * template name in half.
 */
export function functionOf(frame: string): string {
  return frame.replace(/ [^\s]+:\d+$/, "");
}

/** Where a function was seen, for the line a reader hovers. */
export function locationOf(frame: string): string {
  const m = / ([^\s]+:\d+)$/.exec(frame);
  return m?.[1] ?? "";
}

async function stacksOf(tenantId: string, w: ProfileWindow): Promise<StackRow[]> {
  const where = [
    "p.service_name = {service:String}",
    "p.profile_type = {type:String}",
    "p.ts >= {from:DateTime64(9)}",
    "p.ts < {to:DateTime64(9)}",
  ];
  if (w.environment) where.push("p.environment = {environment:String}");
  return read<StackRow>(
    tenantId,
    // The join is the storage's whole shape: samples carry a stack id, frames
    // live once. Aggregating before the join would be cheaper still, but the
    // frames are what the grouping is *by*.
    `SELECT s.frames AS frames,
            toString(sum(p.value)) AS total,
            any(p.sample_unit) AS unit
       FROM ${PROFILES} AS p
       INNER JOIN ${PROFILE_STACKS} AS s ON s.stack_id = p.stack_id
      WHERE ${where.join(" AND ")}
      GROUP BY frames
      ORDER BY sum(p.value) DESC
      LIMIT 50000`,
    {
      params: {
        service: w.service,
        type: w.type,
        from: chTime(w.from),
        to: chTime(w.to),
        ...(w.environment ? { environment: w.environment } : {}),
      },
      maxRows: 50_000,
    },
  );
}

export async function flamegraph(tenantId: string, w: ProfileWindow): Promise<Flamegraph> {
  const rows = await stacksOf(tenantId, w);
  const total = rows.reduce((sum, r) => sum + Number(r.total), 0);
  const root: FlameNode = { name: "all", at: "", value: total, children: [] };
  const floor = total * PRUNE_BELOW;
  let pruned = 0;

  for (const row of rows) {
    const value = Number(row.total);
    if (value < floor) {
      pruned += value;
      continue;
    }
    // Stored leaf first, drawn root first: a flamegraph reads outward from the
    // entry point, and reversing here is the only place that has to know.
    let node = root;
    for (let i = row.frames.length - 1; i >= 0; i--) {
      const frame = row.frames[i]!;
      const name = functionOf(frame);
      let child = node.children.find((c) => c.name === name);
      if (!child) {
        child = { name, at: locationOf(frame), value: 0, children: [] };
        node.children.push(child);
      }
      child.value += value;
      node = child;
    }
  }

  sortTree(root);
  return {
    root,
    total,
    unit: rows[0]?.unit ?? "",
    stacks: rows.length,
    pruned,
  };
}

/** Widest first, at every level: a flamegraph read left to right is a ranking. */
function sortTree(node: FlameNode): void {
  node.children.sort((a, b) => b.value - a.value);
  for (const child of node.children) sortTree(child);
}

export type FunctionRow = {
  name: string;
  at: string;
  /** Spent in this frame itself, with nothing below it. */
  self: number;
  /** Everything that passed through it, however deep. */
  total: number;
};

/**
 * One row per function, with self and total.
 *
 * The two answer different questions and both are needed. `self` finds the
 * function that is actually burning the time; `total` finds the one that
 * *causes* it — often three frames up, and the only one anybody can change.
 *
 * A function appearing twice in one stack — recursion — counts once towards
 * its total. Counting it per occurrence would give a recursive function a
 * total larger than the profile.
 */
export async function profileFunctions(
  tenantId: string,
  w: ProfileWindow,
  limit = 100,
): Promise<{ rows: FunctionRow[]; total: number; unit: string }> {
  const stacks = await stacksOf(tenantId, w);
  const self = new Map<string, number>();
  const total = new Map<string, number>();
  const where = new Map<string, string>();
  let grand = 0;

  for (const row of stacks) {
    const value = Number(row.total);
    grand += value;
    const leaf = row.frames[0];
    if (leaf) {
      const fn = functionOf(leaf);
      self.set(fn, (self.get(fn) ?? 0) + value);
      if (!where.has(fn)) where.set(fn, locationOf(leaf));
    }
    // A set, so recursion counts once: a function that appears four times in
    // one stack did not cost that stack four times over, and counting it per
    // occurrence gives a recursive function a total larger than the profile.
    for (const frame of new Set(row.frames.map(functionOf))) {
      total.set(frame, (total.get(frame) ?? 0) + value);
      if (!where.has(frame)) where.set(frame, "");
    }
  }

  const rows = [...total]
    .map(([name, t]) => ({ name, at: where.get(name) ?? "", self: self.get(name) ?? 0, total: t }))
    .sort((a, b) => b.self - a.self || b.total - a.total)
    .slice(0, limit);
  return { rows, total: grand, unit: stacks[0]?.unit ?? "" };
}

export type DiffRow = {
  name: string;
  /** Time in the frame itself, before and after. */
  beforeSelf: number;
  afterSelf: number;
  selfShare: number;
  /** Everything that passed through it, before and after. */
  beforeTotal: number;
  afterTotal: number;
  totalShare: number;
  /** Whichever of the two moved most — what the rows are ranked on. */
  worst: number;
};

/**
 * What changed between two windows.
 *
 * Compared as **shares**, not as absolute values, and that is the first
 * difficulty of a profile diff. Two windows are never the same length and
 * never carry the same load: a service that did twice the work shows every
 * function twice as expensive, and reading that as a regression is the
 * commonest mistake made with these. Normalising both sides asks the only
 * question worth asking — did this function take a bigger slice?
 *
 * The second difficulty is that **self time is not enough**. A change that
 * moves work between callers leaves every leaf exactly where it was: making a
 * health check call the same expensive hash forty times more often does not
 * shift a single nanosecond of `self` in the hash itself, and a diff ranked on
 * self shows nothing while the service burns. What moved is the *total* of the
 * caller. Both are computed, and a row is ranked on whichever moved more.
 */
export async function profileDiff(
  tenantId: string,
  before: ProfileWindow,
  after: ProfileWindow,
  limit = 40,
): Promise<{ rows: DiffRow[]; beforeTotal: number; afterTotal: number; unit: string }> {
  const [a, b] = await Promise.all([
    profileFunctions(tenantId, before, 100_000),
    profileFunctions(tenantId, after, 100_000),
  ]);
  const share = (rows: FunctionRow[], grand: number) => {
    const self = new Map<string, number>();
    const total = new Map<string, number>();
    for (const r of rows) {
      self.set(r.name, grand > 0 ? r.self / grand : 0);
      total.set(r.name, grand > 0 ? r.total / grand : 0);
    }
    return { self, total };
  };
  const was = share(a.rows, a.total);
  const is = share(b.rows, b.total);

  const names = new Set([...was.self.keys(), ...is.self.keys()]);
  const rows: DiffRow[] = [];
  for (const name of names) {
    const selfShare = (is.self.get(name) ?? 0) - (was.self.get(name) ?? 0);
    const totalShare = (is.total.get(name) ?? 0) - (was.total.get(name) ?? 0);
    if (selfShare === 0 && totalShare === 0) continue;
    rows.push({
      name,
      beforeSelf: Math.round((was.self.get(name) ?? 0) * a.total),
      afterSelf: Math.round((is.self.get(name) ?? 0) * b.total),
      selfShare,
      beforeTotal: Math.round((was.total.get(name) ?? 0) * a.total),
      afterTotal: Math.round((is.total.get(name) ?? 0) * b.total),
      totalShare,
      worst: Math.abs(totalShare) >= Math.abs(selfShare) ? totalShare : selfShare,
    });
  }
  rows.sort((x, y) => Math.abs(y.worst) - Math.abs(x.worst));
  return { rows: rows.slice(0, limit), beforeTotal: a.total, afterTotal: b.total, unit: b.unit };
}

/** Which services and kinds have a profile in the window, for the pickers. */
export async function profileKinds(
  tenantId: string,
  sinceHours = 24,
): Promise<
  Array<{ service_name: string; profile_type: string; sample_unit: string; samples: string }>
> {
  return read(
    tenantId,
    `SELECT p.service_name AS service_name,
            p.profile_type AS profile_type,
            any(p.sample_unit) AS sample_unit,
            toString(count()) AS samples
       FROM ${PROFILES} AS p
      WHERE p.ts >= now() - INTERVAL {since:UInt32} HOUR
      GROUP BY service_name, profile_type
      -- CPU first, because it is what anybody opens a profile screen for; the
      -- rest alphabetically. Sorting purely by name put "allocated objects"
      -- in front of it, which is the answer to a question nobody asked yet.
      ORDER BY service_name, profile_type != 'cpu', profile_type`,
    { params: { since: sinceHours } },
  );
}

function chTime(d: Date): string {
  return d.toISOString().replace("T", " ").replace("Z", "");
}
