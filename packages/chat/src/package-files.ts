import { crc32, deflateRawSync, deflateSync } from "node:zlib";

/**
 * Small, dependency-free file builders for the app packages: the brand mark
 * as PNG (the Teams Store wants a 192 px colour icon and a 32 px white outline
 * on transparency) and a zip to hold them with the manifest.
 */

/** The mark: three strokes crossing — the logo of the sidebar, rasterised. */
function markCoverage(x: number, y: number, size: number, stroke: number): number {
  const s = size / 48;
  const segs: Array<[number, number, number, number]> = [
    [24, 9, 24, 39],
    [11, 16.5, 37, 31.5],
    [37, 16.5, 11, 31.5],
  ];
  const px = x / s;
  const py = y / s;
  for (const [ax, ay, bx, by] of segs) {
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
    const cx = ax + t * dx - px;
    const cy = ay + t * dy - py;
    if (cx * cx + cy * cy <= (stroke / 2) ** 2) return 1;
  }
  return 0;
}

function insideRounded(x: number, y: number, size: number, r: number): boolean {
  const cx = Math.min(Math.max(x, r), size - r);
  const cy = Math.min(Math.max(y, r), size - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function png(size: number, pixel: (x: number, y: number) => [number, number, number, number]) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = a;
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    // PNG wants a zlib stream (header, deflate, checksum): deflateSync, not raw.
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** 4×4 supersampling: smooth edges without a graphics library. */
function sampled(size: number, at: (x: number, y: number) => [number, number, number, number]) {
  return png(size, (x, y) => {
    let sr = 0;
    let sg = 0;
    let sb = 0;
    let sa = 0;
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 4; j++) {
        const [r, g, b, a] = at(x + (i + 0.5) / 4, y + (j + 0.5) / 4);
        sr += r * a;
        sg += g * a;
        sb += b * a;
        sa += a;
      }
    if (sa === 0) return [0, 0, 0, 0];
    return [Math.round(sr / sa), Math.round(sg / sa), Math.round(sb / sa), Math.round(sa / 16)];
  });
}

/** 192 px: the white mark on the brand square, rounded. */
export function colorIcon(size = 192): Buffer {
  return sampled(size, (x, y) => {
    if (!insideRounded(x, y, size, size * 0.21)) return [0, 0, 0, 0];
    return markCoverage(x, y, size, 7) ? [255, 255, 255, 255] : [0x0b, 0x4a, 0x6f, 255];
  });
}

/** 32 px: the mark alone, white on transparency, as the Store requires. */
export function outlineIcon(size = 32): Buffer {
  return sampled(size, (x, y) =>
    markCoverage(x, y, size, 6) ? [255, 255, 255, 255] : [0, 0, 0, 0],
  );
}

/** A zip archive (deflate), enough for an app package. */
export function zip(files: Array<{ name: string; data: Buffer }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, "utf8");
    const packed = deflateRawSync(f.data);
    const crc = crc32(f.data) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, packed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(f.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + packed.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}
