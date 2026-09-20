/**
 * Snappy, decompression only, because Prometheus remote write is snappy.
 *
 * Written here rather than pulled in: the format's decoder is a tag byte and
 * four cases, the only dependencies that offer it are native bindings or a
 * wrapper around them, and a native module in the ingestion path is a build
 * that breaks on somebody else's architecture at the worst moment. Compression
 * is not implemented — nothing here produces snappy.
 *
 * The format (the "raw" one, not the framed stream): a varint holding the
 * uncompressed length, then elements. Each element's tag byte carries its type
 * in the low two bits — a literal, or a copy from what has already been
 * written, with a one, two or four byte offset.
 */

export class SnappyError extends Error {}

/** A ceiling, so a two-byte header cannot ask for a gigabyte of memory. */
export const MAX_UNCOMPRESSED = 64 * 1024 * 1024;

export function snappyDecode(input: Buffer): Buffer {
  let at = 0;

  // The uncompressed length, as a varint. Reading it first is what lets the
  // output be allocated once instead of grown.
  let length = 0;
  let shift = 0;
  for (;;) {
    if (at >= input.length) throw new SnappyError("truncated before the length");
    const byte = input[at++]!;
    length |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7;
    if (shift > 28) throw new SnappyError("length varint is too long");
  }
  if (length > MAX_UNCOMPRESSED) {
    throw new SnappyError(`this body claims to unpack to ${length} bytes, above the ceiling`);
  }

  const out = Buffer.allocUnsafe(length);
  let written = 0;

  while (at < input.length) {
    const tag = input[at++]!;
    const kind = tag & 0x03;

    if (kind === 0) {
      // A literal: the bytes that follow, copied straight out. Lengths up to
      // 60 ride in the tag; beyond that the tag says how many bytes hold it.
      let len = tag >> 2;
      if (len >= 60) {
        const extra = len - 59;
        if (at + extra > input.length) throw new SnappyError("truncated literal length");
        len = 0;
        for (let i = 0; i < extra; i++) len |= input[at + i]! << (8 * i);
        at += extra;
      }
      len += 1;
      if (at + len > input.length) throw new SnappyError("truncated literal");
      if (written + len > length) throw new SnappyError("literal runs past the stated length");
      input.copy(out, written, at, at + len);
      written += len;
      at += len;
      continue;
    }

    let len: number;
    let offset: number;
    if (kind === 1) {
      len = 4 + ((tag >> 2) & 0x07);
      if (at >= input.length) throw new SnappyError("truncated one-byte copy");
      offset = ((tag >> 5) << 8) | input[at++]!;
    } else if (kind === 2) {
      len = (tag >> 2) + 1;
      if (at + 2 > input.length) throw new SnappyError("truncated two-byte copy");
      offset = input.readUInt16LE(at);
      at += 2;
    } else {
      len = (tag >> 2) + 1;
      if (at + 4 > input.length) throw new SnappyError("truncated four-byte copy");
      offset = input.readUInt32LE(at);
      at += 4;
    }

    if (offset === 0 || offset > written) throw new SnappyError("copy reaches outside the output");
    if (written + len > length) throw new SnappyError("copy runs past the stated length");
    // Byte by byte, and deliberately not `copy`: a copy is allowed to overlap
    // its own source — that is how the format expresses a repeated run — and a
    // block move would read the bytes it has not written yet.
    let from = written - offset;
    for (let i = 0; i < len; i++) out[written++] = out[from++]!;
  }

  if (written !== length) {
    throw new SnappyError(`unpacked ${written} bytes where the header said ${length}`);
  }
  return out;
}
