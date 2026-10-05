#!/usr/bin/env bash
# Throw-away OpenWrt containers with internet access for checking the package manager per release
# (T28 of the P1 plan). eth0 is the LAN with a static address and Docker's gateway as default route,
# so LuCI is reachable through the port mapping and opkg/apk can download.
# Usage: scripts/pm-router.sh up <version> <port> <host-octet> | down <version>
#   e.g. scripts/pm-router.sh up 23.05.6 18380 23   -> 172.42.0.23, http://127.0.0.1:18380
set -euo pipefail
export MSYS_NO_PATHCONV=1
V="${2:?version}"
NAME="routelink-pm-$V"
NET="routelink-pm"
case "${1:-}" in
  up)
    PORT="${3:?port}"
    IP="172.42.0.${4:?host octet}"
    docker rm -f "$NAME" >/dev/null 2>&1 || true
    docker network create --subnet 172.42.0.0/24 "$NET" >/dev/null 2>&1 || true
    docker create --name "$NAME" --cap-add NET_ADMIN --cap-add NET_RAW --network "$NET" --ip "$IP" \
      -p "127.0.0.1:$PORT:80" "openwrt/rootfs:x86-64-v$V" /sbin/init >/dev/null
    TMP="$(mktemp)"
    cat >"$TMP" <<EOF
config interface 'loopback'
	option device 'lo'
	option proto 'static'
	option ipaddr '127.0.0.1'
	option netmask '255.0.0.0'

config interface 'lan'
	option device 'eth0'
	option proto 'static'
	option ipaddr '$IP'
	option netmask '255.255.255.0'
	option gateway '172.42.0.1'
	list dns '1.1.1.1'
EOF
    SRC="$TMP"
    command -v cygpath >/dev/null 2>&1 && SRC="$(cygpath -w "$TMP")"
    docker cp "$SRC" "$NAME:/etc/config/network"
    rm -f "$TMP"
    docker start "$NAME" >/dev/null
    for _ in $(seq 1 60); do
      curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$PORT/" && break
      sleep 1
    done
    docker exec "$NAME" sh -c 'printf "routelink-test\nroutelink-test\n" | passwd root >/dev/null 2>&1'
    echo "OpenWrt $V ready: http://127.0.0.1:$PORT"
    ;;
  down)
    docker rm -f "$NAME" >/dev/null 2>&1 || true
    ;;
  *)
    echo "usage: $0 up <version> <port> <host-octet> | down <version>" >&2
    exit 2
    ;;
esac
