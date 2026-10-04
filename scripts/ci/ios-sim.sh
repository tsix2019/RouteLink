#!/usr/bin/env bash
# Boots an iOS 26 iPhone simulator and prints its UDID (prefers "iPhone 17 Pro").
set -euo pipefail
LIST="$(xcrun simctl list devices available -j)"
UDID="$(echo "$LIST" | jq -r '[.devices | to_entries[] | select(.key | test("iOS-26")) | .value[] | select(.name == "iPhone 17 Pro")][0].udid // empty')"
if [ -z "$UDID" ]; then
  UDID="$(echo "$LIST" | jq -r '[.devices | to_entries[] | select(.key | test("iOS-26")) | .value[] | select(.name | startswith("iPhone"))][0].udid // empty')"
fi
[ -n "$UDID" ] || { echo "no iOS 26 iPhone simulator available" >&2; exit 1; }
xcrun simctl boot "$UDID" 2>/dev/null || true
xcrun simctl bootstatus "$UDID" -b >&2
echo "$UDID"
