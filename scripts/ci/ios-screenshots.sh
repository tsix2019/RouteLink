#!/usr/bin/env bash
# Demo-mode screenshots on an iOS simulator (plan T59, P1 T44): zh/en x light/dark x the screens below.
# Usage: scripts/ci/ios-screenshots.sh <simulator udid>   (the app must already be installed)
set -euo pipefail
UDID="$1"
# name:route — the route is what routelink://demo opens (see src/features/demo/route.ts).
PAGES=(overview devices device wireless network more traffic:network/traffic traffic-live:traffic-live
  traffic-device:traffic-device wan:network/traffic/wan agent:more/agent)
xcrun simctl status_bar "$UDID" override --time 9:41 --dataNetwork wifi --wifiMode active --wifiBars 3 \
  --cellularMode active --cellularBars 4 --batteryState charged --batteryLevel 100

# Warm-up: the very first launch after installing is slow (fonts, caches) and would spoil a shot.
xcrun simctl launch --terminate-running-process "$UDID" io.github.tsix2019.routelink \
  -RouteLinkLaunchURL "routelink://demo?lang=en&route=/overview" >/dev/null
sleep 20

for lang in zh en; do
  mkdir -p "docs/screenshots/$lang"
  for theme in light dark; do
    xcrun simctl ui "$UDID" appearance "$theme"
    for entry in "${PAGES[@]}"; do
      page="${entry%%:*}"
      route="${entry#*:}"
      # Relaunch for every shot (clean navigation, warmed-up demo router). The link goes in as a launch
      # argument: `simctl openurl` would make iOS ask "Open in RouteLink?".
      xcrun simctl launch --terminate-running-process "$UDID" io.github.tsix2019.routelink \
        -RouteLinkLaunchURL "routelink://demo?lang=$lang&theme=$theme&route=/$route" >/dev/null
      sleep 10
      xcrun simctl io "$UDID" screenshot "docs/screenshots/$lang/ios-$page-$theme.png" >/dev/null
      echo "docs/screenshots/$lang/ios-$page-$theme.png"
    done
  done
done
