#!/usr/bin/env bash
# Demo-mode screenshots on an iOS simulator (plan T59): zh/en x light/dark x six screens.
# Usage: scripts/ci/ios-screenshots.sh <simulator udid>   (the app must already be installed)
set -euo pipefail
UDID="$1"
PAGES=(overview devices device wireless network more)
xcrun simctl status_bar "$UDID" override --time 9:41 --dataNetwork wifi --wifiMode active --wifiBars 3 \
  --cellularMode active --cellularBars 4 --batteryState charged --batteryLevel 100

for lang in zh en; do
  mkdir -p "docs/screenshots/$lang"
  for theme in light dark; do
    xcrun simctl ui "$UDID" appearance "$theme"
    for page in "${PAGES[@]}"; do
      # Relaunch for every shot: a clean navigation stack and a demo router that has warmed up.
      xcrun simctl terminate "$UDID" io.github.tsix2019.routelink >/dev/null 2>&1 || true
      xcrun simctl launch "$UDID" io.github.tsix2019.routelink >/dev/null
      sleep 3
      xcrun simctl openurl "$UDID" "routelink://demo?lang=$lang&theme=$theme&route=/$page"
      sleep 6
      xcrun simctl io "$UDID" screenshot "docs/screenshots/$lang/ios-$page-$theme.png" >/dev/null
      echo "docs/screenshots/$lang/ios-$page-$theme.png"
    done
  done
done
