import { currentSnapshot } from "@/lib/snapshot";

export const dynamic = "force-dynamic";

/**
 * GET /calendar/<maintenance id> — the maintenance window as an .ics file.
 *
 * The design puts an "Add to calendar" button beside a planned window, and a
 * button that does nothing is worse than no button. This is the whole feature:
 * one event, read from the same snapshot the page renders, with a stable UID so
 * a second download updates the entry instead of duplicating it.
 */

/** RFC 5545: CRLF line endings, escaped separators, and no line over 75 octets. */
function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function fold(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let start = 0;
  while (start < bytes.length) {
    let end = Math.min(start + (start === 0 ? 75 : 74), bytes.length);
    // Never split a multi-byte character.
    while (end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end--;
    out.push((start === 0 ? "" : " ") + bytes.subarray(start, end).toString("utf8"));
    start = end;
  }
  return out.join("\r\n");
}

const stamp = (iso: string) =>
  new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const cur = await currentSnapshot();
  if (!cur) return new Response("Not found", { status: 404 });
  const { id } = await params;
  const m = cur.snap.maintenances.find((x) => x.id === id);
  if (!m || m.status === "cancelled") return new Response("Not found", { status: 404 });

  const summary = `${cur.snap.page.name} — ${m.title}`;
  const description = [m.body, m.components.length ? m.components.join(", ") : ""]
    .filter(Boolean)
    .join("\n");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Open Incident//Status//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${m.id}@${new URL(cur.origin).host}`,
    `DTSTAMP:${stamp(cur.snap.generatedAt)}`,
    `DTSTART:${stamp(m.startAt)}`,
    `DTEND:${stamp(m.endAt)}`,
    `SUMMARY:${esc(summary)}`,
    description ? `DESCRIPTION:${esc(description)}` : "",
    `URL:${cur.origin}/#maintenance-${m.id}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);

  return new Response(lines.map(fold).join("\r\n") + "\r\n", {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `attachment; filename="maintenance-${m.id}.ics"`,
      "cache-control": "no-store",
    },
  });
}
