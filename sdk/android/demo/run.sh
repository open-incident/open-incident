#!/usr/bin/env bash
#
# Builds the harness and runs it on a booted emulator or device.
#
# An SDK verified only by unit tests is an SDK nobody has watched send
# anything, and the interesting failures — a cleartext policy that blocks the
# request, a batch that never flushes because the app never stops, a device
# string nobody would recognise — only appear on a device.
#
#   OI_APP=<rum application id> ./run.sh
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
export ANDROID_HOME="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
export PATH="$ANDROID_HOME/platform-tools:$PATH"

# The Android Gradle Plugin does not support a daemon JVM newer than 21, and a
# machine with a newer default fails with a message about class file versions
# that names neither Gradle nor the JDK.
if [ -z "${JAVA_HOME:-}" ] && [ -x /usr/libexec/java_home ]; then
  for v in 21 17; do
    if home="$(/usr/libexec/java_home -v "$v" 2>/dev/null)"; then
      export JAVA_HOME="$home"
      break
    fi
  done
fi

# 10.0.2.2 is the emulator's alias for the host machine's loopback: inside the
# guest, `localhost` is the guest.
endpoint="${OI_ENDPOINT:-http://10.0.2.2:4318}"

"$here/../gradlew" -p "$here/.." :demo:assembleDebug -q
adb install -r "$here/build/outputs/apk/debug/demo-debug.apk" >/dev/null

# The id travels as an intent extra rather than being compiled in, so the same
# APK can be pointed at another instance.
adb shell am start -n dev.openincident.rumdemo/.MainActivity \
  --es oi_app "${OI_APP:-}" \
  --es oi_endpoint "$endpoint" >/dev/null

echo "launched dev.openincident.rumdemo"
echo "  application: ${OI_APP:-<unset: set OI_APP>}"
echo "  endpoint:    $endpoint"
