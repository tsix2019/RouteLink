#!/usr/bin/env bash
# Builds routelinkd + luci-app-routelink with the official OpenWrt SDK in Docker.
# The SDK and its feeds live in a Docker volume, so only the first run downloads them.
# Usage: scripts/agent-build.sh [release] [arch]   (default: 24.10.8 x86_64)
# Output: openwrt/out/<release>/<arch>/*.ipk (or *.apk from 25.12 on)
#
# ROUTELINK_KEYS=<dir> signs .apk packages (25.12+) with <dir>/apk-private-key.pem like CI does, so they
# install through LuCI's package helper once routelink-apk.pem is in /etc/apk/keys.
set -euo pipefail
REL="${1:-24.10.8}"
ARCH="${2:-x86_64}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE="openwrt/sdk:$ARCH-$REL"
VOL="routelink-sdk-$ARCH-$REL"
OUT="$ROOT/openwrt/out/$REL/$ARCH"
FEED="$ROOT/openwrt"
KEYS="${ROUTELINK_KEYS:-}"
mkdir -p "$OUT"
rm -f "$OUT"/*.ipk "$OUT"/*.apk
KEY_MOUNT=()
if [ -n "$KEYS" ]; then
  [ -d "$KEYS" ] || { echo "ROUTELINK_KEYS=$KEYS is not a directory" >&2; exit 1; }
  K="$KEYS"
  command -v cygpath >/dev/null 2>&1 && K="$(cygpath -w "$KEYS")"
  KEY_MOUNT=(-v "$K:/keys:ro")
fi
if command -v cygpath >/dev/null 2>&1; then # docker.exe needs Windows paths
  OUT="$(cygpath -w "$OUT")"
  FEED="$(cygpath -w "$FEED")"
fi

MSYS_NO_PATHCONV=1 docker run --rm -v "$VOL:/builder" -v "$FEED:/feed:ro" -v "$OUT:/out" "${KEY_MOUNT[@]}" "$IMAGE" bash -c '
set -e
[ -f setup.sh ] && [ ! -d staging_dir ] && bash setup.sh # snapshot images download the SDK here
if [ ! -f .routelink-feeds ]; then
  sed -e "s,https://git.openwrt.org/feed/,https://github.com/openwrt/," \
      -e "s,https://git.openwrt.org/openwrt/,https://github.com/openwrt/," \
      -e "s,https://git.openwrt.org/project/,https://github.com/openwrt/," \
      feeds.conf.default > feeds.conf
  echo "src-link routelink /feed" >> feeds.conf
  ./scripts/feeds update -a >/dev/null
  touch .routelink-feeds
else
  ./scripts/feeds update routelink >/dev/null
fi
./scripts/feeds install -p routelink -f routelinkd luci-app-routelink >/dev/null
make defconfig >/dev/null
for p in routelinkd luci-app-routelink; do
  make package/$p/clean >/dev/null 2>&1 || true
done
if ! make package/routelinkd/compile package/luci-app-routelink/compile -j"$(nproc)" V=s >build.log 2>&1; then
  grep -nE "error:|Error [0-9]|missing dependencies|^ERROR" -A3 build.log | tail -40
  exit 1
fi
cp bin/packages/*/routelink/*.[ia]pk /out/
# apk (25.12+) refuses unsigned local packages: sign each one like CI (adbsign takes one file per call)
if [ -f /keys/apk-private-key.pem ]; then
  for f in /out/*.apk; do
    [ -f "$f" ] && staging_dir/host/bin/apk adbsign --allow-untrusted --reset-signatures \
      --sign-key /keys/apk-private-key.pem "$f"
  done
fi
ls /out
'
