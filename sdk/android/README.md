# Open Incident RUM — Android

Android library, API 21+, no dependencies. JSON comes from `org.json` and the
request from `HttpURLConnection`, both in the platform — adding this cannot
drag a second copy of OkHttp into your app.

## Add it

```kotlin
implementation("dev.openincident:rum:0.1.0")
```

(While it lives in this repository, include the `:rum` project directly.)

## Start it

```kotlin
OpenIncidentRum.start(
    context = this,
    applicationId = "<the RUM application id>",
    endpoint = "https://otlp.<your workspace host>",
    sampleRate = 1.0,
    service = "checkout-android",
)
```

That alone gives you sessions, the device, and cold start. The rest is one line
per thing worth measuring:

```kotlin
OpenIncidentRum.screen("Checkout")                       // and screen_load
OpenIncidentRum.action("add_to_cart", mapOf("items" to "3"))
OpenIncidentRum.resource(url, method = "POST", status = 201, durationMs = 143.0)
OpenIncidentRum.error(throwable)
OpenIncidentRum.identify("user-42")                      // hashed on arrival
```

The library declares `INTERNET` and nothing else.

The workspace must **accept mobile applications** first — see
[`../README.md`](../README.md), which also says why that is a switch rather
than a default, and what this SDK deliberately does not do.

## Run the harness

```bash
# with an emulator or device attached
OI_APP=<application id> ./demo/run.sh
```

It builds the APK, installs it and starts it, passing the application id as an
intent extra so the same build can be pointed anywhere. From an emulator the
host machine is `10.0.2.2`, which is the default endpoint.

## The rules this code is written under

1. **It never throws into the host application.** Every public entry point
   swallows its own failure; a mistake costs its measurement and nothing else.
2. **It never blocks.** One background thread takes every call. Nothing is
   encoded, and no request made, on the thread drawing the screen.
