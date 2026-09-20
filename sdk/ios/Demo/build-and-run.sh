#!/usr/bin/env bash
#
# Builds the harness for the iOS simulator and runs it, with no Xcode project.
#
# An SDK verified only by unit tests is an SDK nobody has watched send
# anything, and the interesting failures — App Transport Security, the device
# identifier a simulator reports, a batch that never flushes because the app
# never backgrounds — only appear when it actually runs.
#
#   OI_APP=<rum application id> ./build-and-run.sh
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
out="${TMPDIR:-/tmp}/oi-rum-demo"
app="$out/OIRumDemo.app"
sdk="$(xcrun --sdk iphonesimulator --show-sdk-path)"
endpoint="${OI_ENDPOINT:-http://localhost:4318}"
device="${OI_SIMULATOR:-iPhone 17}"

rm -rf "$out"; mkdir -p "$app"

target="arm64-apple-ios17.0-simulator"

# The library is built as its own module and then imported, rather than having
# every file compiled into the app. That is the point of the exercise: it is
# what proves the package is importable and that its public surface really is
# public — compiling the sources together would hide both.
swiftc \
  -sdk "$sdk" -target "$target" \
  -O -whole-module-optimization \
  -emit-module -emit-module-path "$out/OpenIncidentRUM.swiftmodule" \
  -emit-library -static -o "$out/libOpenIncidentRUM.a" \
  -module-name OpenIncidentRUM \
  "$here"/../Sources/OpenIncidentRUM/*.swift

swiftc \
  -sdk "$sdk" -target "$target" \
  -O -whole-module-optimization \
  -module-name OIRumDemo \
  -I "$out" -L "$out" -lOpenIncidentRUM \
  "$here"/AppDelegate.swift \
  "$here"/main.swift \
  -o "$app/OIRumDemo"

cp "$here/Info.plist" "$app/Info.plist"

# One booted simulator, whichever it is. `simctl` refuses to install into a
# device that is merely created, and booting one that already runs is an error
# rather than a no-op — hence the `|| true`.
udid="$(xcrun simctl list devices available -j | python3 -c '
import json,sys
d=json.load(sys.stdin)["devices"]
for runtime, devices in d.items():
    for dev in devices:
        if dev.get("state") == "Booted":
            print(dev["udid"]); raise SystemExit
for runtime, devices in d.items():
    if "iOS" not in runtime: continue
    for dev in devices:
        if dev["name"] == "'"$device"'":
            print(dev["udid"]); raise SystemExit
')"
[ -n "$udid" ] || { echo "no simulator named \"$device\"; try OI_SIMULATOR=..." >&2; exit 1; }

xcrun simctl boot "$udid" 2>/dev/null || true
xcrun simctl bootstatus "$udid" -b >/dev/null
xcrun simctl install "$udid" "$app"

# `SIMCTL_CHILD_` is how an environment variable reaches the application rather
# than `simctl` itself — the harness reads OI_APP and OI_ENDPOINT from its own
# environment so nothing has to be compiled in.
SIMCTL_CHILD_OI_APP="${OI_APP:-}" \
SIMCTL_CHILD_OI_ENDPOINT="$endpoint" \
  xcrun simctl launch --terminate-running-process "$udid" dev.openincident.rumdemo >/dev/null

echo "launched dev.openincident.rumdemo on $udid"
echo "  application: ${OI_APP:-<unset: set OI_APP>}"
echo "  endpoint:    $endpoint"
