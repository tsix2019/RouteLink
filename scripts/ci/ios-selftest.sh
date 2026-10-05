#!/usr/bin/env bash
# Native self-test on an iOS simulator (plan T58/T59).
# Usage: scripts/ci/ios-selftest.sh <RouteLink.app> <simulator udid>
# The app must be built with EXPO_PUBLIC_SELFTEST=1.
set -euo pipefail
APP="$1"
UDID="$2"
OUT="${RUNNER_TEMP:-/tmp}/selftest"
rm -rf "$OUT" && mkdir -p "$OUT"

python3 scripts/ci/selftest-servers.py "$OUT" > "$OUT/servers.log" 2>&1 &
SERVERS=$!
# The SSH server (M4) runs in its own virtualenv: Homebrew's Python refuses global pip installs.
python3 -m venv "$OUT/venv" && "$OUT/venv/bin/pip" install -q asyncssh
"$OUT/venv/bin/python" scripts/ci/selftest-ssh.py "$OUT" > "$OUT/ssh.log" 2>&1 &
SSH=$!
trap 'kill $SERVERS $SSH 2>/dev/null || true' EXIT
for _ in $(seq 1 30); do grep -q ready "$OUT/servers.log" 2>/dev/null && break; sleep 1; done
for _ in $(seq 1 30); do grep -q "ssh ready" "$OUT/ssh.log" 2>/dev/null && break; sleep 1; done
FP="$(cat "$OUT/fp.txt")"
# base64url: "+" and "/" do not survive the deep link reliably.
SSH_FP="$(tr '+/' '-_' < "$OUT/ssh-fp.txt")"

xcrun simctl install "$UDID" "$APP"
enc() { python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$1"; }
URL="routelink://selftest?http=$(enc http://127.0.0.1:8098)&https=$(enc https://127.0.0.1:8443)&fp=$FP&report=$(enc http://127.0.0.1:8099/report)"
URL="$URL&ssh=$(enc 127.0.0.1:2222)&sshFp=$(enc "$SSH_FP")&sshUser=root&sshPassword=routelink-test&sshAuthorize=$(enc http://127.0.0.1:8097/authorize)"
# A launch argument instead of `simctl openurl`: iOS would ask "Open in RouteLink?" for the latter.
xcrun simctl launch --terminate-running-process "$UDID" io.github.tsix2019.routelink -RouteLinkLaunchURL "$URL" >/dev/null

for _ in $(seq 1 120); do [ -f "$OUT/selftest-report.json" ] && break; sleep 1; done
xcrun simctl io "$UDID" screenshot "$OUT/selftest.png" >/dev/null 2>&1 || true
if [ ! -f "$OUT/selftest-report.json" ]; then
  echo "no self-test report within 120 s" >&2
  cat "$OUT/ssh.log" >&2 || true
  exit 1
fi
jq . "$OUT/selftest-report.json"
jq -e '.passed == true' "$OUT/selftest-report.json" >/dev/null
