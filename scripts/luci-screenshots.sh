#!/usr/bin/env bash
# Screenshots of the RouteLink LuCI pages on the plugin test router, in English and Chinese.
# Usage: scripts/luci-screenshots.sh [en|zh_cn ...]   -> docs/screenshots/luci/<lang>-<page>.png
set -euo pipefail
export MSYS_NO_PATHCONV=1
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/docs/screenshots/luci"
mkdir -p "$OUT"
SRC="$ROOT/scripts/luci-screenshots.js"
if command -v cygpath >/dev/null 2>&1; then
  OUT_W="$(cygpath -w "$OUT")"
  SRC_W="$(cygpath -w "$SRC")"
else
  OUT_W="$OUT"
  SRC_W="$SRC"
fi
rc=0
for lang in "${@:-en zh_cn}"; do
  for l in $lang; do
    docker exec routelink-agent-owrt sh -c "uci set luci.main.lang=$l && uci commit luci && rm -rf /tmp/luci-*"
    docker run --rm --init --network routelink-agent-lan -e SHOT_LANG="${l%%_*}" \
      -v "$OUT_W:/out" -v "$SRC_W:/home/pptruser/shot.js:ro" \
      ghcr.io/puppeteer/puppeteer:latest node /home/pptruser/shot.js || rc=1
  done
done
docker exec routelink-agent-owrt sh -c 'uci set luci.main.lang=auto && uci commit luci'
exit $rc
