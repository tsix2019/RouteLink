#!/usr/bin/env bash
# Pre-commit gate: typecheck, lint (warnings fail too) and unit tests.
# Usage: scripts/verify.sh [jest path filters...]
set -euo pipefail
cd "$(dirname "$0")/.."
npm run -s typecheck
npx eslint . --max-warnings 0
out="$(mktemp)"
if ! npx jest --silent "$@" >"$out" 2>&1; then
  grep -E "Tests:|Test Suites:|●" -A6 "$out" | head -60
  rm -f "$out"
  exit 1
fi
grep -E "Tests:" "$out"
rm -f "$out"
echo "verify: ok"
