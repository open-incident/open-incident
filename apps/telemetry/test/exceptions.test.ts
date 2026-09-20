/**
 * Fingerprinting — the test §15.14 asks for, and the one that decides whether
 * the Exceptions screen is readable.
 *
 * Two properties are being asserted, and they pull in opposite directions:
 * the same bug must fingerprint the same across occurrences that differ in
 * their variable parts, and two different bugs must not collide. Every case
 * below is one of those two, written from a real shape of stack trace.
 */
import { describe, expect, it } from "vitest";
import {
  exceptionFromAttributes,
  fingerprintOf,
  isInApp,
  normaliseMessage,
  parseFrames,
} from "../src/exceptions";

const NODE_STACK = `Error: connection terminated
    at Pool.charge (/app/src/payments/pool.ts:118:11)
    at Checkout.submit (/app/src/checkout.ts:42:13)
    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)
    at Object.<anonymous> (/app/node_modules/pg/lib/client.js:512:9)`;

const PYTHON_STACK = `Traceback (most recent call last):
  File "/srv/app/checkout.py", line 42, in charge
    pool.acquire()
  File "/usr/lib/python3.11/site-packages/psycopg/pool.py", line 88, in acquire
    raise PoolTimeout("pool exhausted")
psycopg.PoolTimeout: pool exhausted`;

describe("a stack trace becomes frames", () => {
  it("reads the V8 shape, with and without a function name", () => {
    const frames = parseFrames(NODE_STACK);
    expect(frames[0]).toMatchObject({
      function: "Pool.charge",
      file: "/app/src/payments/pool.ts",
      line: 118,
    });
    expect(frames).toHaveLength(4);
  });

  it("reads the Python shape", () => {
    const frames = parseFrames(PYTHON_STACK);
    expect(frames[0]).toMatchObject({ file: "/srv/app/checkout.py", line: 42, function: "charge" });
  });

  it("reads the Java shape", () => {
    const frames = parseFrames("\tat com.acme.Checkout.charge(Checkout.java:42)");
    expect(frames[0]).toMatchObject({ function: "com.acme.Checkout.charge", line: 42 });
  });

  it("knows whose code a frame belongs to", () => {
    expect(isInApp("/app/src/checkout.ts")).toBe(true);
    expect(isInApp("/app/node_modules/pg/lib/client.js")).toBe(false);
    expect(isInApp("node:internal/process/task_queues")).toBe(false);
    expect(isInApp("/usr/lib/python3.11/site-packages/psycopg/pool.py")).toBe(false);
  });
});

describe("a message loses what varies between occurrences", () => {
  it("takes out numbers, ids, paths, urls and quoted strings", () => {
    expect(normaliseMessage("user 4821 not found")).toBe("user <n> not found");
    expect(normaliseMessage("user 9134 not found")).toBe("user <n> not found");
    expect(normaliseMessage("failed to open /var/data/run-17/state.db")).toContain("<path>");
    expect(normaliseMessage("GET https://api.acme.test/v1/charge timed out")).toContain("<url>");
    expect(normaliseMessage("no row for 550e8400-e29b-41d4-a716-446655440000")).toContain("<uuid>");
  });
});

describe("the fingerprint groups the same bug and separates different ones", () => {
  it("is stable when only the variable parts of the message change", () => {
    const frames = parseFrames(NODE_STACK);
    const a = fingerprintOf("Error", "user 4821 not found", frames);
    const b = fingerprintOf("Error", "user 9134 not found", frames);
    expect(a).toBe(b);
  });

  it("is stable when a dependency frame below our code changes", () => {
    const withPg = fingerprintOf("Error", "connection terminated", parseFrames(NODE_STACK));
    const withOther = fingerprintOf(
      "Error",
      "connection terminated",
      parseFrames(NODE_STACK.replace("pg/lib/client.js:512:9", "pg/lib/client.js:998:2")),
    );
    expect(withPg).toBe(withOther);
  });

  it("separates two callers of the same failure", () => {
    const one = fingerprintOf("Error", "connection terminated", parseFrames(NODE_STACK));
    const two = fingerprintOf(
      "Error",
      "connection terminated",
      parseFrames(
        NODE_STACK.replace(
          "Checkout.submit (/app/src/checkout.ts:42:13",
          "Refund.submit (/app/src/refund.ts:77:3",
        ),
      ),
    );
    expect(one).not.toBe(two);
  });

  it("separates two types raised from the same line", () => {
    const frames = parseFrames(NODE_STACK);
    expect(fingerprintOf("TimeoutError", "x", frames)).not.toBe(
      fingerprintOf("PoolError", "x", frames),
    );
  });
});

describe("recognising an exception in what arrives", () => {
  it("reads the semantic convention attributes when they are there", () => {
    const e = exceptionFromAttributes(
      {
        "exception.type": "PoolTimeout",
        "exception.message": "pool exhausted",
        "exception.stacktrace": PYTHON_STACK,
      },
      "",
      { traceId: "abc", spanId: "def" },
    );
    expect(e?.type).toBe("PoolTimeout");
    expect(e?.frames.some((f) => f.in_app)).toBe(true);
  });

  it("recognises a log that carries a stack and nothing else", () => {
    const e = exceptionFromAttributes({}, NODE_STACK, { traceId: "", spanId: "" });
    expect(e).not.toBeNull();
    expect(e!.type).toBe("Error");
    expect(e!.message).toBe("connection terminated");
  });

  it("leaves an ordinary log alone", () => {
    expect(
      exceptionFromAttributes({}, "checkout completed in 61 ms", { traceId: "", spanId: "" }),
    ).toBeNull();
  });
});
