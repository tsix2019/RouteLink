#!/usr/bin/env bash
# Installs the locally built packages into the plugin test router (scripts/agent-router.sh).
# Usage: scripts/agent-dev-install.sh [release] [arch]   (default: 24.10.8 x86_64)
set -euo pipefail
REL="${1:-24.10.8}"
ARCH="${2:-x86_64}"
NAME="routelink-agent-owrt"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$ROOT/openwrt/out/$REL/$ARCH"
ls "$DIR"/*.[ia]pk >/dev/null
MSYS_NO_PATHCONV=1 docker exec "$NAME" sh -c 'rm -rf /tmp/rl-pkg && mkdir -p /tmp/rl-pkg'
for f in "$DIR"/*.[ia]pk; do
  SRC="$f"
  command -v cygpath >/dev/null 2>&1 && SRC="$(cygpath -w "$f")"
  MSYS_NO_PATHCONV=1 docker cp "$SRC" "$NAME:/tmp/rl-pkg/" >/dev/null
done
MSYS_NO_PATHCONV=1 docker exec "$NAME" sh -c '
set -e
cd /tmp/rl-pkg
order="routelinkd luci-app-routelink luci-i18n-routelink-zh-cn"
if command -v apk >/dev/null 2>&1; then
  [ -d /var/cache/apk ] && ls /var/cache/apk/*.adb >/dev/null 2>&1 || apk update >/dev/null
  files=""; for p in $order; do files="$files $(ls ${p}-[0-9]*.apk)"; done
  apk add --allow-untrusted $files
else
  [ -s /var/opkg-lists/openwrt_core ] || opkg update >/dev/null
  files=""; for p in $order; do files="$files $(ls ${p}_*.ipk)"; done
  opkg install --force-reinstall $files
fi
sleep 2
ubus call routelink info
'
