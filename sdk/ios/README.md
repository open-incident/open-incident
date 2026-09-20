# Open Incident RUM — iOS

Swift package, iOS 13+, no dependencies.

## Add it

```swift
.package(url: "https://github.com/open-incident/open-incident", from: "0.1.0")
```

…and depend on the `OpenIncidentRUM` product. (While it lives in this
repository, point at `sdk/ios` with `.package(path:)`.)

## Start it

```swift
import OpenIncidentRUM

OpenIncidentRUM.start(
    applicationId: "<the RUM application id>",
    endpoint: URL(string: "https://otlp.<your workspace host>")!,
    sampleRate: 1,
    service: "checkout-ios"
)
```

That alone gives you sessions, the device, and cold start. The rest is one line
per thing worth measuring:

```swift
OpenIncidentRUM.screen("Checkout")                         // and screen_load
OpenIncidentRUM.action("add_to_cart", attributes: ["items": "3"])
OpenIncidentRUM.resource(url: url, method: "POST", status: 201, durationMs: 143)
OpenIncidentRUM.error(error)
OpenIncidentRUM.identify("user-42")                        // hashed on arrival
```

The workspace must **accept mobile applications** first — see
[`../README.md`](../README.md), which also says why that is a switch rather
than a default, and what this SDK deliberately does not do.

## Run the harness

```bash
OI_APP=<application id> ./Demo/build-and-run.sh
```

It builds the library as its own module, links a minimal UIKit app against it
and launches that on a booted simulator — no Xcode project. It exists because
an SDK verified only by unit tests is an SDK nobody has watched send anything.

## The rules this code is written under

1. **It never throws into the host application.** No `try` in the public
   surface, no force-unwrap below it. A failure costs its own measurement.
2. **It never blocks.** Every call hands work to a serial queue and returns.
   Nothing is encoded, and no request made, on the thread drawing the screen.
