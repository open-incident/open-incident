/** RSS 2.0 and Atom feeds of a page's incidents and maintenances, from its snapshot. */
import type { Snapshot } from "./snapshot";

const esc = (s: string) =>
  s.replace(
    /[<>&"']/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!,
  );

type Item = { id: string; title: string; body: string; at: string; url: string };

function items(snap: Snapshot, origin: string): Item[] {
  const out: Item[] = [];
  for (const i of snap.incidents)
    for (const u of i.updates)
      out.push({
        id: `${i.id}:${u.at}`,
        title: `${i.title} — ${u.status}`,
        body: u.body,
        at: u.at,
        url: `${origin}/#incident-${i.id}`,
      });
  for (const m of snap.maintenances) {
    out.push({
      id: `${m.id}:scheduled`,
      title: `Maintenance: ${m.title}`,
      body: `${m.body}\n${m.startAt} → ${m.endAt}`,
      at: m.startAt,
      url: `${origin}/#maintenance-${m.id}`,
    });
    for (const u of m.updates)
      out.push({
        id: `${m.id}:${u.at}`,
        title: `Maintenance: ${m.title} — ${u.status}`,
        body: u.body,
        at: u.at,
        url: `${origin}/#maintenance-${m.id}`,
      });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 50);
}

export function rssFeed(snap: Snapshot, origin: string): string {
  const list = items(snap, origin);
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>${esc(snap.page.name)}</title><link>${esc(origin)}</link><description>${esc(`${snap.page.name} — status updates`)}</description><lastBuildDate>${new Date(snap.generatedAt).toUTCString()}</lastBuildDate>
${list.map((i) => `<item><guid isPermaLink="false">${esc(i.id)}</guid><title>${esc(i.title)}</title><link>${esc(i.url)}</link><pubDate>${new Date(i.at).toUTCString()}</pubDate><description>${esc(i.body)}</description></item>`).join("\n")}
</channel></rss>
`;
}

export function atomFeed(snap: Snapshot, origin: string): string {
  const list = items(snap, origin);
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>${esc(snap.page.name)}</title><id>${esc(origin)}/</id><link href="${esc(origin)}"/><updated>${esc(snap.generatedAt)}</updated>
${list.map((i) => `<entry><id>urn:openincident:${esc(i.id)}</id><title>${esc(i.title)}</title><link href="${esc(i.url)}"/><updated>${esc(i.at)}</updated><content type="text">${esc(i.body)}</content></entry>`).join("\n")}
</feed>
`;
}
