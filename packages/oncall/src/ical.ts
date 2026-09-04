/** iCalendar export of a schedule's shifts — one VEVENT per shift, per person. */
import type { Shift } from "./rotation";

function ics(d: Date): string {
  return d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}
function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

export function scheduleToIcs(input: {
  name: string;
  workspace: string;
  shifts: Shift[];
  nameOf: (memberId: string | null) => string;
  url?: string;
}): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Open Incident//On-call//EN",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${esc(`${input.name} · ${input.workspace}`)}`,
  ];
  for (const s of input.shifts) {
    const who = input.nameOf(s.memberId);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${s.rotationId}-${ics(s.startAt)}@openincident`,
      `DTSTAMP:${ics(new Date())}`,
      `DTSTART:${ics(s.startAt)}`,
      `DTEND:${ics(s.endAt)}`,
      `SUMMARY:${esc(`On-call · ${who}${s.override ? " (override)" : ""} · ${s.rotationName}`)}`,
      `DESCRIPTION:${esc(`${input.name} — ${s.rotationName}`)}`,
      ...(input.url ? [`URL:${input.url}`] : []),
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
