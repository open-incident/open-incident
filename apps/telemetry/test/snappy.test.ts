/**
 * The snappy decoder, against streams built by hand.
 *
 * Hand-built because the point of writing the decoder was not to depend on a
 * compressor, and a test that needs one to make its fixtures would have
 * brought the dependency back in through the side door. Each fixture below is
 * the format's own encoding, spelled out — which is also the clearest
 * statement of what the decoder is supposed to read.
 */
import { describe, expect, it } from "vitest";
import { SnappyError, snappyDecode } from "../src/snappy";

/** A varint, for the uncompressed length that opens every stream. */
function varint(n: number): number[] {
  const out: number[] = [];
  while (n >= 0x80) {
    out.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  out.push(n);
  return out;
}

/** A literal element: the tag, then the bytes. */
function literal(bytes: Buffer): number[] {
  if (bytes.length <= 60) return [(bytes.length - 1) << 2, ...bytes];
  const len = bytes.length - 1;
  // Two bytes of length, which is tag value 61.
  return [(61 - 59 + 59) << 2, len & 0xff, (len >> 8) & 0xff, ...bytes];
}

describe("a snappy stream", () => {
  it("reads a single literal", () => {
    const text = Buffer.from("hello, prometheus");
    const stream = Buffer.from([...varint(text.length), ...literal(text)]);
    expect(snappyDecode(stream).toString()).toBe("hello, prometheus");
  });

  it("reads a copy with a one-byte offset", () => {
    // "abcdabcd": four literal bytes, then a copy of four from four back.
    const stream = Buffer.from([
      ...varint(8),
      ...literal(Buffer.from("abcd")),
      0x01 | ((4 - 4) << 2) | ((4 >> 8) << 5),
      4,
    ]);
    expect(snappyDecode(stream).toString()).toBe("abcdabcd");
  });

  it("reads a copy that overlaps its own source", () => {
    // The format's way of writing a repeated run: one literal byte, then a
    // copy of nine from one byte back. A block move would read bytes it has
    // not written yet and produce rubbish.
    const stream = Buffer.from([...varint(10), ...literal(Buffer.from("x")), 0x01 | (5 << 2), 1]);
    expect(snappyDecode(stream).toString()).toBe("x".repeat(10));
  });

  it("reads a copy with a two-byte offset", () => {
    const head = Buffer.from("z".repeat(300) + "tail");
    const stream = Buffer.from([
      ...varint(head.length + 4),
      ...literal(head),
      0x02 | ((4 - 1) << 2),
      4,
      0,
    ]);
    expect(snappyDecode(stream).toString()).toBe(head.toString() + "tail");
  });

  it("reads a literal longer than sixty bytes", () => {
    const text = Buffer.from("p".repeat(500));
    const stream = Buffer.from([...varint(text.length), ...literal(text)]);
    expect(snappyDecode(stream)).toEqual(text);
  });
});

describe("what it refuses", () => {
  it("refuses a body that claims an absurd size", () => {
    // A two-byte header asking for a gigabyte is how a decoder is turned into
    // an allocator: the ceiling is checked before anything is allocated.
    const huge = Buffer.from([...varint(200 * 1024 * 1024), 0x00, 0x61]);
    expect(() => snappyDecode(huge)).toThrow(/above the ceiling/);
  });

  it("refuses a copy that reaches before the output", () => {
    // Offset 4 with nothing written yet: in a permissive decoder this reads
    // whatever was in the buffer, which is somebody else's memory.
    const stream = Buffer.from([...varint(8), 0x01 | (0 << 2), 4]);
    expect(() => snappyDecode(stream)).toThrow(SnappyError);
  });

  it("refuses a stream that stops in the middle", () => {
    expect(() => snappyDecode(Buffer.from([...varint(10), 0x20]))).toThrow(/truncated/);
  });

  it("refuses a stream that unpacks to the wrong size", () => {
    const stream = Buffer.from([...varint(99), ...literal(Buffer.from("short"))]);
    expect(() => snappyDecode(stream)).toThrow(/where the header said/);
  });
});
