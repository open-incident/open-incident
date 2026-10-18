/* global self, clients */
/* Open Incident — web push service worker: shows the page and opens it on click. */
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Open Incident", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Open Incident";
  const options = {
    body: data.body || "",
    // Atlas's notices carry their own one-tap actions, each a signed link.
    data: {
      url: data.url || "/",
      ackUrl: data.ackUrl || null,
      links: Object.fromEntries((data.actions || []).map((a) => [a.action, a.url])),
    },
    requireInteraction: !data.silent,
    silent: Boolean(data.silent),
    tag: data.tag || data.url || "open-incident",
    actions: data.actions
      ? data.actions.map((a) => ({ action: a.action, title: a.title }))
      : data.ackUrl
        ? [{ action: "ack", title: "Acknowledge" }]
        : [],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const d = event.notification.data;
  const link = event.action && d.links ? d.links[event.action] : null;
  const target = link || (event.action === "ack" && d.ackUrl ? d.ackUrl : d.url);
  event.waitUntil(clients.openWindow(target));
});
