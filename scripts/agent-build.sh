#!/usr/bin/env bash
# Builds routelinkd + luci-app-routelink with the official OpenWrt SDK in Docker.
# The SDK and its feeds live in a Docker volume, so only the first run downloads them.
# Usage: scripts/agent-build.sh [release] [arch]   (default: 24.10.8 x86_64)
# Output: openwrt/out/<release>/<arch>/*.ipk (or *.apk from 25.12 on)
#
# ROUTELINK_KEYS=<dir> signs like CI does: <dir>/apk-private-key.pem signs .apk packages (25.12+),
# <dir>/usign-key-build is the opkg feed key. Keys never leave the build container's volume mount.
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
SIGN=
rm -f private-key.pem key-build
if [ -d /keys ]; then
  [ -f /keys/apk-private-key.pem ] && cp /keys/apk-private-key.pem private-key.pem
  [ -f /keys/usign-key-build ] && cp /keys/usign-key-build key-build
  SIGN=CONFIG_SIGNED_PACKAGES=y
fi
for p in routelinkd luci-app-routelink; do
  make package/$p/clean >/dev/null 2>&1 || true
done
if ! make package/routelinkd/compile package/luci-app-routelink/compile $SIGN -j"$(nproc)" V=s >build.log 2>&1; then
  grep -nE "error:|Error [0-9]|missing dependencies|^ERROR" -A3 build.log | tail -40
  rm -f private-key.pem key-build
  exit 1
fi
rm -f private-key.pem key-build
cp bin/packages/*/routelink/*.[ia]pk /out/
ls /out
'
