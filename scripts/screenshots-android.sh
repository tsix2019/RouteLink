#!/usr/bin/env bash
# Demo-mode screenshots on an Android emulator (plan T62, P1 T44): zh/en x light/dark x the screens below.
# Usage: scripts/screenshots-android.sh [adb serial]   (PAGES_ONLY="traffic wan" limits the screens)
# Install a release build first (no developer overlays); the app opens itself via routelink://demo.
set -euo pipefail
SERIAL="${1:-${ANDROID_SERIAL:-}}"
ADB=(adb)
[ -n "$SERIAL" ] && ADB=(adb -s "$SERIAL")
PKG=io.github.tsix2019.routelink
# name:route — the route is what routelink://demo opens (see src/features/demo/route.ts).
PAGES=(overview devices device wireless network more traffic:network/traffic traffic-live:traffic-live
  traffic-device:traffic-device wan:network/traffic/wan agent:more/agent guest:wireless/guest
  firewall:network/firewall connections:network/connections packages:more/packages processes:more/processes
  parental:device-schedule wifi-schedule:wireless/schedule vlan:network/vlan wireguard:network/wireguard
  adblock:network/adblock ddns:network/ddns firmware:more/firmware backup:more/backup)

demo() { "${ADB[@]}" shell am broadcast -a com.android.systemui.demo -e command "$@" >/dev/null; }

# A clean, identical status bar on every shot.
"${ADB[@]}" shell settings put global sysui_demo_allowed 1
demo enter
demo clock -e hhmm 0941
demo battery -e level 100 -e plugged false
demo network -e wifi show -e level 4 -e mobile show -e datatype none -e level 4
demo notifications -e visible false
trap 'demo exit' EXIT

# Warm-up: the first launch after installing is slow and would spoil a shot.
"${ADB[@]}" shell am force-stop "$PKG"
MSYS_NO_PATHCONV=1 "${ADB[@]}" shell am start -W -a android.intent.action.VIEW \
  -d "'routelink://demo?lang=en&route=/overview'" "$PKG" >/dev/null
sleep 15

for lang in zh en; do
  mkdir -p "docs/screenshots/$lang"
  for theme in light dark; do
    if [ "$theme" = dark ]; then "${ADB[@]}" shell cmd uimode night yes >/dev/null; else "${ADB[@]}" shell cmd uimode night no >/dev/null; fi
    for entry in "${PAGES[@]}"; do
      page="${entry%%:*}"
      route="${entry#*:}"
      if [ -n "${PAGES_ONLY:-}" ] && [[ " $PAGES_ONLY " != *" $page "* ]]; then continue; fi
      # Fresh start for every shot: clean navigation and a warmed-up demo router.
      "${ADB[@]}" shell am force-stop "$PKG"
      MSYS_NO_PATHCONV=1 "${ADB[@]}" shell am start -W -a android.intent.action.VIEW \
        -d "'routelink://demo?lang=$lang&theme=$theme&route=/$route'" "$PKG" >/dev/null
      sleep 6
      # Live rates draw their little curves as samples arrive (one every 2 s): give them time to grow.
      if [ "$page" = traffic-live ]; then sleep 40; fi
      "${ADB[@]}" exec-out screencap -p > "docs/screenshots/$lang/android-$page-$theme.png"
      echo "docs/screenshots/$lang/android-$page-$theme.png"
    done
  done
done
"${ADB[@]}" shell cmd uimode night no >/dev/null
