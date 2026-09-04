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
    data: { url: data.url || "/", ackUrl: data.ackUrl || null },
    requireInteraction: true,
    tag: data.url || "open-incident",
    actions: data.ackUrl ? [{ action: "ack", title: "Acknowledge" }] : [],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.action === "ack" && event.notification.data.ackUrl ? event.notification.data.ackUrl : event.notification.data.url;
  event.waitUntil(clients.openWindow(target));
});
