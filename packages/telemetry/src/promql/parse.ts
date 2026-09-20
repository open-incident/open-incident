/**
 * PromQL — the published subset, and a parser that says what it cannot do.
 *
 * Decision D24 is the shape of this file: a subset compiled to SQL, not a
 * complete engine. A complete one is neither useful here nor maintainable by a
 * team this size, and pretending otherwise would mean shipping a language that
 * silently computes something else than Prometheus would.
 *
 * So every construction outside the subset raises `PromqlError` **naming the
 * construction**. A query that cannot be answered exactly is an error message,
 * never a partial result — the difference between a dashboard that says "I
 * cannot do `histogram_quantile` yet" and one that quietly draws the wrong
 * line.
 */

export class PromqlError extends Error {
  constructor(
    message: string,
    readonly construct?: string,
  ) {
    super(message);
    this.name = "PromqlError";
  }
}

export type MatchOp = "=" | "!=" | "=~" | "!~";
export type Matcher = { label: string; op: MatchOp; value: string };

export type Node =
  | { kind: "number"; value: number }
  | { kind: "selector"; metric: string; matchers: Matcher[]; range?: number; offset?: number }
  | { kind: "call"; name: string; args: Node[] }
  | { kind: "aggregation"; op: string; by: string[]; without: string[]; arg: Node; param?: Node }
  | { kind: "binary"; op: string; left: Node; right: Node };

/** Everything the evaluator implements. Anything else is named and refused. */
export const FUNCTIONS = new Set([
  "rate",
  "irate",
  "increase",
  "delta",
  "avg_over_time",
  "sum_over_time",
  "min_over_time",
  "max_over_time",
  "count_over_time",
  "last_over_time",
  "abs",
  "clamp_min",
  "clamp_max",
  "round",
]);

export const AGGREGATIONS = new Set(["sum", "avg", "min", "max", "count", "topk", "bottomk"]);

/** Named so the error can say which of these is still missing. */
export const PLANNED = new Set([
  "histogram_quantile",
  "label_replace",
  "quantile",
  "stddev",
  "stdvar",
]);

/** `5m`, and the compound form the language also allows: `1h30m`, `2d12h`. */
const DURATION = /^(?:[0-9]+(?:ms|s|m|h|d|w|y))+$/;
const DURATION_PART = /([0-9]+)(ms|s|m|h|d|w|y)/g;
const UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
  y: 31_536_000_000,
};

export function parseDuration(text: string): number {
  if (!DURATION.test(text)) throw new PromqlError(`"${text}" is not a duration`, "duration");
  let total = 0;
  for (const m of text.matchAll(DURATION_PART)) total += Number(m[1]) * UNIT_MS[m[2]!]!;
  return total;
}

type Token = { type: "name" | "number" | "string" | "op"; value: string };

function lex(input: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const c = input[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[A-Za-z_:]/.test(c)) {
      let j = i;
      while (j < input.length && /[A-Za-z0-9_:.]/.test(input[j]!)) j++;
      out.push({ type: "name", value: input.slice(i, j) });
      i = j;
      continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i;
      while (j < input.length && /[0-9.eE+-]/.test(input[j]!)) {
        // `1e-3` is a number, `5 - 3` is not: only accept a sign right after an exponent.
        if (/[+-]/.test(input[j]!) && !/[eE]/.test(input[j - 1] ?? "")) break;
        j++;
      }
      // A duration is one token, not a number followed by a name: `5m` lexed
      // as `5` and `m` turns `[5m]` into a syntax error and `offset 1h` into a
      // metric called `h`.
      const rest = input.slice(j);
      const dur = /^(?:(?:ms|s|m|h|d|w|y)(?:[0-9]+)?)+/.exec(rest);
      if (dur && !/^[A-Za-z_]/.test(rest.slice(dur[0].length))) {
        out.push({ type: "name", value: input.slice(i, j) + dur[0] });
        i = j + dur[0].length;
        continue;
      }
      out.push({ type: "number", value: input.slice(i, j) });
      i = j;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      let value = "";
      while (j < input.length && input[j] !== c) {
        if (input[j] === "\\") j++;
        value += input[j];
        j++;
      }
      out.push({ type: "string", value });
      i = j + 1;
      continue;
    }
    const two = input.slice(i, i + 2);
    if (["=~", "!~", "==", "!=", ">=", "<=", "=="].includes(two)) {
      out.push({ type: "op", value: two });
      i += 2;
      continue;
    }
    out.push({ type: "op", value: c });
    i++;
  }
  return out;
}

class Parser {
  private i = 0;
  constructor(private readonly tokens: Token[]) {}

  private peek(): Token | undefined {
    return this.tokens[this.i];
  }
  private next(): Token {
    const t = this.tokens[this.i++];
    if (!t) throw new PromqlError("unexpected end of query");
    return t;
  }
  private eat(value: string): boolean {
    if (this.peek()?.value === value) {
      this.i++;
      return true;
    }
    return false;
  }
  private expect(value: string): void {
    if (!this.eat(value)) throw new PromqlError(`expected "${value}"`);
  }

  parse(): Node {
    const node = this.expression(0);
    if (this.peek()) throw new PromqlError(`unexpected "${this.peek()!.value}"`);
    // Prometheus' own rule: an expression cannot evaluate to a range vector.
    // Caught here rather than at evaluation so the message reaches whoever
    // typed it, in the editor rather than in a failed panel.
    if (node.kind === "selector" && node.range !== undefined) {
      throw new PromqlError(
        "a range vector must be inside a function such as rate() or avg_over_time()",
        "range vector",
      );
    }
    return node;
  }

  /** Precedence climbing, with Prometheus' own table. */
  private expression(min: number): Node {
    let left = this.unary();
    for (;;) {
      const op = this.peek();
      if (!op || op.type !== "op") break;
      const prec = PRECEDENCE[op.value];
      if (prec === undefined || prec < min) break;
      this.i++;
      // Vector matching keywords are parsed only to be refused clearly.
      for (const kw of ["on", "ignoring", "group_left", "group_right"]) {
        if (this.peek()?.value === kw) {
          throw new PromqlError(`vector matching with "${kw}" is not supported yet`, kw);
        }
      }
      const right = this.expression(prec + 1);
      left = { kind: "binary", op: op.value, left, right };
    }
    return left;
  }

  private unary(): Node {
    if (this.eat("-")) {
      const n = this.unary();
      return { kind: "binary", op: "*", left: n, right: { kind: "number", value: -1 } };
    }
    this.eat("+");
    return this.atom();
  }

  private atom(): Node {
    const t = this.next();
    if (t.type === "number") return { kind: "number", value: Number(t.value) };
    if (t.value === "(") {
      const n = this.expression(0);
      this.expect(")");
      return n;
    }
    if (t.type !== "name") throw new PromqlError(`unexpected "${t.value}"`);

    if (AGGREGATIONS.has(t.value)) return this.aggregation(t.value);
    if (PLANNED.has(t.value)) throw new PromqlError(`"${t.value}" is not supported yet`, t.value);
    if (this.peek()?.value === "(") {
      if (!FUNCTIONS.has(t.value)) throw new PromqlError(`unknown function "${t.value}"`, t.value);
      this.expect("(");
      const args: Node[] = [];
      if (!this.eat(")")) {
        do args.push(this.expression(0));
        while (this.eat(","));
        this.expect(")");
      }
      return { kind: "call", name: t.value, args };
    }
    return this.selector(t.value);
  }

  private aggregation(op: string): Node {
    let by: string[] = [];
    let without: string[] = [];
    const grouping = () => {
      if (this.eat("by")) by = this.labelList();
      else if (this.eat("without")) without = this.labelList();
    };
    grouping();
    this.expect("(");
    const args: Node[] = [];
    do args.push(this.expression(0));
    while (this.eat(","));
    this.expect(")");
    grouping();

    if ((op === "topk" || op === "bottomk") && args.length !== 2)
      throw new PromqlError(`"${op}" takes a count and a vector`, op);
    const arg = op === "topk" || op === "bottomk" ? args[1]! : args[0]!;
    const param = op === "topk" || op === "bottomk" ? args[0] : undefined;
    if (!arg) throw new PromqlError(`"${op}" needs an argument`, op);
    return { kind: "aggregation", op, by, without, arg, ...(param ? { param } : {}) };
  }

  private labelList(): string[] {
    this.expect("(");
    const out: string[] = [];
    if (!this.eat(")")) {
      do out.push(this.next().value);
      while (this.eat(","));
      this.expect(")");
    }
    return out;
  }

  private selector(metric: string): Node {
    const matchers: Matcher[] = [];
    if (this.eat("{")) {
      if (!this.eat("}")) {
        do {
          const label = this.next().value;
          const op = this.next().value as MatchOp;
          if (!["=", "!=", "=~", "!~"].includes(op))
            throw new PromqlError(`"${op}" is not a label matcher`, op);
          const value = this.next();
          if (value.type !== "string") throw new PromqlError("a matcher value must be quoted");
          matchers.push({ label, op, value: value.value });
        } while (this.eat(","));
        this.expect("}");
      }
    }
    let range: number | undefined;
    if (this.eat("[")) {
      range = parseDuration(this.next().value);
      this.expect("]");
    }
    let offset: number | undefined;
    if (this.eat("offset")) offset = parseDuration(this.next().value);
    if (this.peek()?.value === "@")
      throw new PromqlError("the @ modifier is not supported yet", "@");
    return {
      kind: "selector",
      metric,
      matchers,
      ...(range !== undefined ? { range } : {}),
      ...(offset !== undefined ? { offset } : {}),
    };
  }
}

const PRECEDENCE: Record<string, number> = {
  or: 1,
  and: 2,
  unless: 2,
  "==": 3,
  "!=": 3,
  ">": 3,
  "<": 3,
  ">=": 3,
  "<=": 3,
  "+": 4,
  "-": 4,
  "*": 5,
  "/": 5,
  "%": 5,
  "^": 6,
};

export function parsePromql(query: string): Node {
  const text = query.trim();
  if (!text) throw new PromqlError("empty query");
  return new Parser(lex(text)).parse();
}
