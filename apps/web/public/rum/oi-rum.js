/**
 * Open Incident — real user monitoring, in a page.
 *
 * Two rules govern everything below, because this code runs on somebody
 * else's site and its worst failure is not missing data, it is breaking the
 * page it was added to:
 *
 *  1. It never throws into the host page. Every observer and every handler is
 *     wrapped, and a failure here costs its own measurement and nothing else.
 *  2. It never delays anything. Events are buffered and flushed on a timer,
 *     on visibility change and on pagehide — with `sendBeacon` where it
 *     exists, which the browser delivers after the page is gone.
 *
 * Use:
 *   <script src="https://<your instance>/rum/oi-rum.js"
 *           data-app="<application id>"
 *           data-endpoint="https://otlp.<your workspace host>"
 *           data-route-attribute="data-route"
 *           defer></script>
 */
(function () {
  "use strict";

  var script = document.currentScript;
  if (!script) return;
  var app = script.getAttribute("data-app");
  var endpoint = (script.getAttribute("data-endpoint") || "").replace(/\/$/, "");
  if (!app || !endpoint) return;

  var sample = parseFloat(script.getAttribute("data-sample") || "1");
  // Decided once per session, not per event: sampling events independently
  // gives half a session, which is worse than none — a timeline with holes
  // reads as a page that stopped rather than one that was not recorded.
  if (!(Math.random() < (isNaN(sample) ? 1 : sample))) return;

  var url = endpoint + "/v1/rum?app=" + encodeURIComponent(app);
  var session = readSession();
  var view = id();
  var queue = [];
  var user = null;

  /* ---------- the queue ---------- */

  function push(event) {
    event.session = session;
    event.view = view;
    event.ts = Date.now();
    event.url = location.href;
    event.route = route();
    if (user) event.user = user;
    queue.push(event);
    // A thousand is the server's ceiling too. A page that produces more than
    // that between flushes is a page with a loop in it, and dropping the
    // oldest keeps the newest — which is the half anybody would want.
    if (queue.length > 1000) queue.splice(0, queue.length - 1000);
    if (queue.length >= 50) flush();
  }

  function flush(beacon) {
    if (queue.length === 0) return;
    var body = JSON.stringify({ events: queue });
    queue = [];
    try {
      // `sendBeacon` is the only thing a browser will still deliver once the
      // page is being torn down, which is exactly when the last and most
      // interesting events are produced.
      if (beacon && navigator.sendBeacon) {
        navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
        return;
      }
      fetch(url, { method: "POST", body: body, keepalive: true, mode: "cors" }).catch(noop);
    } catch (e) {
      noop(e);
    }
  }

  /* ---------- what is measured ---------- */

  var reported = {};

  /**
   * One report per vital per view.
   *
   * A buffered observer can deliver the same entry twice — the navigation
   * entry is updated as the page finishes loading, and Chrome delivers it
   * again — which put two TTFB rows in the table for one page load and made
   * every percentile count it twice.
   */
  function vital(name, value, rating) {
    var key = view + ":" + name;
    if (reported[key]) return;
    reported[key] = 1;
    push({ type: "web_vital", vital: name, value: value, rating: rating || rate(name, value) });
  }

  /**
   * Google's own thresholds, carried in the event rather than applied at read.
   *
   * They move between web-vitals releases, and a chart whose "good" shifted
   * under it is a chart nobody can compare to last month.
   */
  function rate(name, v) {
    var t = { LCP: [2500, 4000], INP: [200, 500], CLS: [0.1, 0.25], FCP: [1800, 3000], TTFB: [800, 1800] }[name];
    if (!t) return "";
    return v <= t[0] ? "good" : v <= t[1] ? "needs-improvement" : "poor";
  }

  function observe(type, fn, options) {
    try {
      var po = new PerformanceObserver(function (list) {
        try {
          fn(list.getEntries());
        } catch (e) {
          noop(e);
        }
      });
      po.observe(Object.assign({ type: type, buffered: true }, options || {}));
      return po;
    } catch {
      // An entry type this browser does not know. Not an error: it is how a
      // feature that does not exist here announces itself.
      return null;
    }
  }

  // LCP: the last one before the first interaction is the real one — the
  // browser keeps reporting larger candidates until the user acts.
  var lcp = 0;
  observe("largest-contentful-paint", function (entries) {
    var last = entries[entries.length - 1];
    if (last) lcp = last.startTime;
  });

  // CLS: the worst *session window* rather than the sum, which is the
  // definition Google settled on after the sum punished long-lived pages.
  var cls = 0;
  var clsWindow = 0;
  var clsFirst = 0;
  var clsLast = 0;
  observe("layout-shift", function (entries) {
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (e.hadRecentInput) continue;
      if (clsWindow && e.startTime - clsLast < 1000 && e.startTime - clsFirst < 5000) {
        clsWindow += e.value;
      } else {
        clsWindow = e.value;
        clsFirst = e.startTime;
      }
      clsLast = e.startTime;
      if (clsWindow > cls) cls = clsWindow;
    }
  });

  // INP: the worst interaction, which is what a person remembers — an average
  // hides the one click that took two seconds.
  var inp = 0;
  observe("event", function (entries) {
    for (var i = 0; i < entries.length; i++) {
      var d = entries[i].duration;
      if (d > inp) inp = d;
    }
  }, { durationThreshold: 40 });

  observe("paint", function (entries) {
    for (var i = 0; i < entries.length; i++) {
      if (entries[i].name === "first-contentful-paint") vital("FCP", entries[i].startTime);
    }
  });

  observe("navigation", function (entries) {
    var n = entries[0];
    if (n) vital("TTFB", n.responseStart);
  });

  observe("longtask", function (entries) {
    for (var i = 0; i < entries.length; i++) {
      push({ type: "long_task", value: entries[i].duration });
    }
  });

  /* ---------- errors ---------- */

  window.addEventListener("error", function (e) {
    try {
      var err = e.error;
      push({
        type: "error",
        errorType: (err && err.name) || "Error",
        message: (err && err.message) || e.message || "",
        stack: (err && err.stack) || "",
      });
    } catch (x) {
      noop(x);
    }
  });

  window.addEventListener("unhandledrejection", function (e) {
    try {
      var r = e.reason;
      push({
        type: "error",
        errorType: (r && r.name) || "UnhandledRejection",
        message: (r && r.message) || String(r),
        stack: (r && r.stack) || "",
      });
    } catch (x) {
      noop(x);
    }
  });

  /* ---------- views ---------- */

  function pageView() {
    view = id();
    // A new view is a new set of vitals: the same page in a single-page
    // application measures its own LCP after a route change.
    reported = {};
    push({ type: "page_view" });
  }
  pageView();

  // A single-page application changes the URL without loading anything, so the
  // history methods are wrapped. Wrapped and called through, never replaced:
  // a router that depends on the return value must keep getting it.
  ["pushState", "replaceState"].forEach(function (name) {
    var original = history[name];
    history[name] = function () {
      var out = original.apply(this, arguments);
      try {
        pageView();
      } catch (e) {
        noop(e);
      }
      return out;
    };
  });
  window.addEventListener("popstate", pageView);

  /* ---------- session replay ---------- */

  /*
   * Recording is off unless the workspace turned it on, and the page is
   * *asked* rather than told. A flag in the snippet would have been one less
   * request, and would have made the switch in the product a lie: turning
   * replay on would mean editing somebody's site.
   *
   * Nothing here is on the critical path. The configuration is fetched after
   * the page has its own work under way, the recorder is a separate file only
   * an application with replay on ever downloads, and every failure is a
   * recording that does not happen rather than a page that does not work.
   */
  var replayParts = [];
  var replayBytes = 0;
  var replayOn = false;

  function replayConfig() {
    try {
      fetch(endpoint + "/v1/rum/config?app=" + encodeURIComponent(app), { mode: "cors" })
        .then(function (r) {
          return r.ok ? r.json() : null;
        })
        .then(function (c) {
          if (!c || !c.replay) return;
          var rate = typeof c.replaySampleRate === "number" ? c.replaySampleRate : 1;
          if (!replayDraw(rate)) return;
          loadRecorder(c.unmask || []);
        })
        .catch(noop);
    } catch (e) {
      noop(e);
    }
  }

  /**
   * Drawn once per session and remembered, like the sampling above.
   *
   * Per page load it would record the first page of a session and not the
   * third, and a recording that stops halfway through a visit is read as the
   * visitor leaving. Without storage the session is one page anyway, so the
   * fallback is consistent rather than merely tolerable.
   */
  function replayDraw(rate) {
    try {
      var held = sessionStorage.getItem("oi_rum_replay");
      if (held === "1") return true;
      if (held === "0") return false;
      var on = Math.random() < rate;
      sessionStorage.setItem("oi_rum_replay", on ? "1" : "0");
      return on;
    } catch {
      return Math.random() < rate;
    }
  }

  /** The chunk counter, shared across the pages of one session. */
  function nextSeq() {
    try {
      var n = parseInt(sessionStorage.getItem("oi_rum_replay_seq") || "0", 10) || 0;
      sessionStorage.setItem("oi_rum_replay_seq", String(n + 1));
      return n;
    } catch {
      return 0;
    }
  }

  function loadRecorder(unmask) {
    // The sibling of whatever this file was served as. Deriving it beats
    // another data attribute, and if this file has been renamed or inlined the
    // derivation fails and nothing is recorded — which is the right way to be
    // wrong: no guessed URL is fetched from somebody's page.
    var src = (script.src || "").replace(/oi-rum\.js(\?.*)?$/, "oi-rum-replay.js");
    if (!src || src === script.src) return;
    var el = document.createElement("script");
    el.src = src;
    el.async = true;
    el.onload = function () {
      try {
        beginRecording(unmask);
      } catch (e) {
        noop(e);
      }
    };
    el.onerror = noop;
    (document.head || document.documentElement).appendChild(el);
  }

  function beginRecording(unmask) {
    var record = window.openIncidentRumRecord;
    if (typeof record !== "function") return;
    var show = usable(unmask);
    replayOn = true;
    // Its own timer, and a shorter one than the beacon's fifteen seconds: what
    // is still buffered when the tab closes has to fit in a `sendBeacon`, and
    // flushing often is what keeps it small. Started here rather than beside
    // the other timer so a page without replay pays nothing for it.
    setInterval(function () {
      flushReplay();
    }, 5000);
    record({
      emit: emitReplay,
      // Masked by default, every text node and every input, and un-masked only
      // where the workspace named a selector. That order is the one that is
      // safe to get wrong: a field somebody forgot to mask is a leak, where a
      // field somebody forgot to un-mask is a replay that is harder to read.
      maskAllInputs: true,
      maskTextSelector: "*",
      maskTextFn: function (text, el) {
        return visible(el, show) ? text : mask(text);
      },
      maskInputFn: function (text, el) {
        return visible(el, show) ? text : mask(text);
      },
      // Canvas is off: it records what was drawn, which on a real site is
      // photographs, signatures and documents, and nobody turning on "session
      // replay" is agreeing to that.
      recordCanvas: false,
      // A fresh snapshot every two minutes, so losing one chunk costs the
      // player two minutes rather than the rest of the session.
      checkoutEveryNms: 120000,
    });
  }

  /** Selectors the browser will actually accept. A typo costs its own rule. */
  function usable(list) {
    var out = [];
    for (var i = 0; i < list.length; i++) {
      try {
        document.createDocumentFragment().querySelector(list[i]);
        out.push(list[i]);
      } catch (e) {
        noop(e);
      }
    }
    return out;
  }

  /** `closest`, so un-masking a container un-masks the text inside it. */
  function visible(el, show) {
    if (!el || show.length === 0) return false;
    for (var i = 0; i < show.length; i++) {
      try {
        if (el.closest(show[i])) return true;
      } catch (e) {
        noop(e);
      }
    }
    return false;
  }

  function mask(text) {
    return String(text).replace(/[^\s]/g, "*");
  }

  /**
   * Each event is serialised once, here, and the strings are joined at flush.
   *
   * Not an optimisation for its own sake: the chunk has to be cut on **bytes**
   * rather than on a count, because `sendBeacon` silently refuses a body over
   * about 64 kB and the last chunk of a session is the one that travels that
   * way. Counting events instead would make the cut depend on how busy the
   * page was, which is exactly when the events are big.
   */
  function emitReplay(event) {
    var text;
    try {
      text = JSON.stringify(event);
    } catch (e) {
      return noop(e);
    }
    replayParts.push(text);
    replayBytes += text.length + 1;
    if (replayBytes >= 48000) flushReplay();
  }

  function flushReplay(beacon) {
    if (replayParts.length === 0) return;
    var body = "[" + replayParts.join(",") + "]";
    replayParts = [];
    replayBytes = 0;
    var u =
      endpoint +
      "/v1/rum/replay?app=" +
      encodeURIComponent(app) +
      "&session=" +
      encodeURIComponent(session) +
      "&seq=" +
      nextSeq();
    try {
      // No `keepalive` on the periodic path: it carries the same 64 kB ceiling
      // as `sendBeacon`, and the first chunk of a page — the one holding the
      // full DOM snapshot — is routinely larger than that.
      if (beacon && navigator.sendBeacon) {
        navigator.sendBeacon(u, new Blob([body], { type: "application/json" }));
        return;
      }
      fetch(u, {
        method: "POST",
        body: body,
        mode: "cors",
        headers: { "content-type": "application/json" },
      }).catch(noop);
    } catch (e) {
      noop(e);
    }
  }

  /* ---------- flushing ---------- */

  // The vitals are only final when the page goes away: LCP keeps growing, CLS
  // keeps shifting and INP keeps getting worse until then. Reporting them
  // early would report a number that was true for a second.
  function finish() {
    if (lcp) vital("LCP", lcp);
    if (cls) vital("CLS", cls);
    if (inp) vital("INP", inp);
    lcp = cls = inp = 0;
    flush(true);
    if (replayOn) flushReplay(true);
  }

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") finish();
  });
  window.addEventListener("pagehide", finish);
  setInterval(function () {
    flush();
  }, 15000);

  replayConfig();

  /* ---------- what the page can call ---------- */

  window.openIncidentRum = {
    /** Name the person, however the application knows them. Hashed on arrival. */
    identify: function (value) {
      user = value ? String(value) : null;
    },
    /** Anything the page wants on the timeline: a click, a step, a checkout. */
    action: function (name, attributes) {
      push({ type: "action", message: String(name || ""), attributes: attributes || {} });
    },
    /** Tie this view to a backend trace, when the page already has the id. */
    trace: function (traceId) {
      push({ type: "page_view", trace: String(traceId || "") });
    },
  };

  /* ---------- helpers ---------- */

  function route() {
    var attribute = script.getAttribute("data-route-attribute");
    if (attribute) {
      var el = document.querySelector("[" + attribute + "]");
      if (el) return el.getAttribute(attribute) || "";
    }
    // Without a route the path is used, with anything that looks like an
    // identifier replaced: `/orders/4821` and `/orders/9134` are one page, and
    // grouping by path gives a table with one row per visitor.
    return location.pathname
      .replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "/:id")
      .replace(/\/\d+/g, "/:id")
      .slice(0, 200);
  }

  function readSession() {
    try {
      var held = sessionStorage.getItem("oi_rum_session");
      if (held) return held;
      var fresh = id();
      sessionStorage.setItem("oi_rum_session", fresh);
      return fresh;
    } catch {
      // Storage refused — a private window, or a browser with cookies off.
      // The session then lasts one page, which is honest: without storage
      // there is no way to know two page loads are the same person.
      return id();
    }
  }

  function id() {
    try {
      return crypto.randomUUID().replace(/-/g, "").slice(0, 24);
    } catch {
      return Math.random().toString(36).slice(2) + Date.now().toString(36);
    }
  }

  function noop() {}
})();
