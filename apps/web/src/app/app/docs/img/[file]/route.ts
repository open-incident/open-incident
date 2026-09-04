import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { guideRoot } from "@/lib/guide";
import { requireMember } from "@/lib/session";

const TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

/** The guide's illustrations, served from docs/guide/img to signed-in members. */
export async function GET(_request: Request, ctx: { params: Promise<{ file: string }> }) {
  await requireMember();
  const { file } = await ctx.params;
  const safe = file.replace(/[^a-zA-Z0-9._-]/g, "");
  const ext = path.extname(safe).toLowerCase();
  const root = guideRoot();
  if (!root || !safe || !TYPES[ext]) return new Response("Not found", { status: 404 });
  const full = path.join(root, "img", safe);
  if (!existsSync(full)) return new Response("Not found", { status: 404 });
  const size = statSync(full).size;
  return new Response(Readable.toWeb(createReadStream(full)) as ReadableStream, {
    headers: {
      "content-type": TYPES[ext]!,
      "content-length": String(size),
      "cache-control": "private, max-age=3600",
      "content-security-policy": "sandbox",
    },
  });
}
