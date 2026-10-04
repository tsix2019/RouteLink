#!/usr/bin/env bash
# Calls ubus on the plugin test router over HTTP like the app does (root / routelink-test).
# Usage: scripts/lab-ubus.sh <object> <method> ['<json params>']
set -euo pipefail
URL="${ROUTER_URL:-http://127.0.0.1:18280}/ubus"
rpc() {
  curl -s "$URL" -H 'Content-Type: application/json' -d "$1"
}
SID=$(rpc '{"jsonrpc":"2.0","id":1,"method":"call","params":["00000000000000000000000000000000","session","login",{"username":"root","password":"'"${ROUTER_PASSWORD:-routelink-test}"'"}]}' |
  sed -n 's/.*"ubus_rpc_session": *"\([0-9a-f]*\)".*/\1/p')
rpc '{"jsonrpc":"2.0","id":2,"method":"call","params":["'"$SID"'","'"$1"'","'"$2"'",'"${3:-{\}}"']}'
echo
