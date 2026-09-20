# Mobile SDKs

Real user monitoring from an application rather than from a page. Both send to
the same endpoint the browser SDK does, arrive in the same tables, and appear
on the same **Telemetry → RUM** screens beside web traffic.

|                       |                                           |
| --------------------- | ----------------------------------------- |
| [`ios/`](ios)         | Swift package, iOS 13+, no dependencies   |
| [`android/`](android) | Android library, API 21+, no dependencies |

## Before anything arrives

A RUM application has to **accept mobile applications** — the switch is on
**Settings → Observability**, beside the application's origins, and it is off
until somebody turns it on.

It is its own switch because it costs something real. A browser is made to send
an `Origin` header it cannot forge, and that header is what stands in for a
credential when the application id is public. An app sends none, so accepting
one means accepting that the id is a **public write-only token**: anybody who
pulls your binary apart can read it and post events. Every mobile RUM SDK works
this way — Sentry's DSN, Datadog's client token, Firebase's config — and the
only honest difference here is that you are told before it is true of your
workspace rather than after.

What that token can do is bounded: write RUM events for one application. It
cannot read anything.

## What both SDKs measure

|                                             |                                                                                                                                                           |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sessions**                                | Resumed for fifteen minutes of silence, then a new one. The sampling draw is taken once per session and kept, so a visit is reported whole or not at all. |
| **`app_start`**                             | From the moment the process began — not from the moment the SDK started, by which point the expensive part is over — to the first frame.                  |
| **`screen_load`**                           | Between two `screen()` calls, counted once per screen. A screen somebody sat on for four minutes is not a four-minute load.                               |
| **Screens, actions, errors, network calls** | One line each, at the place that knows about them.                                                                                                        |

## What neither does: crashes

Neither SDK captures crashes, and that is written here rather than discovered
later. Doing it properly means signal handlers and a Mach exception port on
iOS, a report written to disk and replayed on the next launch, and
symbolication — a subsystem, not a feature. An SDK that claims crash reporting
and delivers a `try`/`catch` is worse than one that says it has none, because
somebody stops looking for a real one. Report what you catch with `error(_:)`.

## Network calls are reported, not intercepted

Both SDKs take a `resource(...)` call rather than installing themselves into
your networking. Interception means a `URLProtocol` that re-issues every
request through a session of ours, or an interceptor in an OkHttp client we do
not own — which changes the behaviour of uploads, streaming and background
transfers in an application nobody here can test. The trade is a line of code
per call site, against no chance of breaking the network of the app we were
added to measure.
