#!/usr/bin/env bash
# Manual checks of routelinkd on the plugin test router (T16/T18 of the P1 plan); prints what happened.
set -uo pipefail
export MSYS_NO_PATHCONV=1
R=(docker exec routelink-agent-owrt)
now=$("${R[@]}" date +%s)

echo "== reload on config change"
"${R[@]}" sh -c 'uci set routelink.main.sample_interval=10 && uci commit routelink && sleep 2 && logread -e routelinkd | tail -1'
"${R[@]}" sh -c 'ubus call routelink info | grep sample_interval'
"${R[@]}" sh -c 'uci set routelink.main.sample_interval=30 && uci commit routelink'

echo "== commit method"
"${R[@]}" ubus call routelink commit

echo "== stop writes before exit"
"${R[@]}" sh -c '/etc/init.d/routelink stop; sleep 1; logread -e routelinkd | tail -2; ls -l /etc/routelink | head -3; /etc/init.d/routelink start; sleep 2'

echo "== sysupgrade backup runs the commit hook"
"${R[@]}" sh -c 'sysupgrade -b /tmp/b.tgz >/dev/null 2>&1; echo rc=$?; tar tzf /tmp/b.tgz | grep routelink'

echo "== service enabled at boot"
"${R[@]}" sh -c 'ls /etc/rc.d/ | grep routelink'

echo "== API: valid calls"
"${R[@]}" ubus call routelink history "{\"start\":$((now - 3600)),\"end\":$now,\"class\":\"wan\",\"max_points\":5}"
"${R[@]}" ubus call routelink events "{\"start\":0,\"end\":$((now + 1)),\"limit\":3}"
"${R[@]}" ubus call routelink summary "{\"start\":$((now - 86400)),\"end\":$now,\"sort\":\"rx\",\"limit\":2}"

echo "== API: invalid calls (each should fail)"
for args in \
  "{\"start\":$now,\"end\":$now}" \
  "{\"start\":$((now - 60)),\"end\":$now,\"max_points\":5000}" \
  "{\"start\":$((now - 60)),\"end\":$now,\"mac\":\"nonsense\"}" \
  "{\"start\":$((now - 60)),\"end\":$now,\"mac\":\"00:11:22:33:44:55\"}" \
  "{\"start\":$((now - 60)),\"end\":$now,\"class\":\"bogus\"}" \
  "{\"start\":$((now - 60)),\"end\":$now,\"hours\":16777216}" \
  "{\"end\":$now}"; do
  printf '%s -> ' "$args"
  "${R[@]}" ubus call routelink history "$args" 2>&1 | head -1
done
printf 'summary sort=bogus -> '
"${R[@]}" ubus call routelink summary "{\"start\":0,\"end\":$now,\"sort\":\"bogus\"}" 2>&1 | head -1
printf 'reset scope=bogus -> '
"${R[@]}" ubus call routelink reset '{"scope":"bogus"}' 2>&1 | head -1
printf 'events types=[nope] -> '
"${R[@]}" ubus call routelink events '{"types":["nope"]}' 2>&1 | head -1
