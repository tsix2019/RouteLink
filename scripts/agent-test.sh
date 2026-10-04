#!/usr/bin/env bash
# Builds and runs the routelinkd core unit tests with ASan + UBSan inside Docker (no gcc on Windows).
# Usage: scripts/agent-test.sh [ctest -R filter]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/openwrt/routelinkd/src"
IMAGE="routelink-ctest"
if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  CTX="$SRC/tests"
  command -v cygpath >/dev/null 2>&1 && CTX="$(cygpath -w "$CTX")"
  docker build -q -t "$IMAGE" "$CTX" >/dev/null
fi
command -v cygpath >/dev/null 2>&1 && SRC="$(cygpath -w "$SRC")"
FILTER="${1:-}"
MSYS_NO_PATHCONV=1 docker run --rm -v "$SRC:/src:ro" -w /tmp "$IMAGE" sh -c "
  cmake -S /src -B b -DRL_TESTS=ON -DRL_SANITIZE=ON >/dev/null &&
  cmake --build b -j \$(nproc) 2>&1 | grep -E 'error|warning' || true;
  cmake --build b -j \$(nproc) >/dev/null &&
  ctest --test-dir b --output-on-failure ${FILTER:+-R $FILTER}"
