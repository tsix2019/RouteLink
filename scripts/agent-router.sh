#!/usr/bin/env bash
# Disposable OpenWrt for the router plugin, separate from scripts/dev-router.sh so that both can run at
# the same time (other sessions use routelink-owrt on 172.30/31.0.0/24).
# Usage: scripts/agent-router.sh up [version] | down [all]
#   version defaults to 24.10.8; "down all" also removes the Docker networks.
#
# LAN 172.40.0.0/24 + fd40::/64 (router .2 / ::2), WAN 172.41.0.0/24 + fd41::/64.
# LuCI and ubus: http://127.0.0.1:18280 (root / routelink-test).
#
# A second instance next to this one (another worktree): RL_AGENT_NAME=<prefix> RL_AGENT_NET=<n>
# RL_AGENT_PORT=<port> gives <prefix>-owrt on 172.<n> / 172.<n+1> with LuCI on that port (the name is
# also read by agent-dev-install.sh).
set -euo pipefail
V="${2:-24.10.8}"
PREFIX="${RL_AGENT_NAME:-routelink-agent}"
N="${RL_AGENT_NET:-40}"
M=$((N + 1))
PORT="${RL_AGENT_PORT:-18280}"
TLS_PORT=$((PORT + 363))
NAME="$PREFIX-owrt"
LAN="$PREFIX-lan"
WAN="$PREFIX-wan"

network_config() {
  cat <<EOF
config interface 'loopback'
	option device 'lo'
	option proto 'static'
	option ipaddr '127.0.0.1'
	option netmask '255.0.0.0'

config globals 'globals'
	option ula_prefix 'fd$N::/48'

config interface 'lan'
	option device 'eth0'
	option proto 'static'
	option ipaddr '172.$N.0.2'
	option netmask '255.255.255.0'
	list ip6addr 'fd$N::2/64'

config interface 'wan'
	option device 'eth1'
	option proto 'static'
	option ipaddr '172.$M.0.2'
	option netmask '255.255.255.0'
	option gateway '172.$M.0.1'
	list dns '1.1.1.1'

config interface 'wan6'
	option device 'eth1'
	option proto 'static'
	list ip6addr 'fd$M::2/64'
EOF
}

# (re)creates a dual-stack network; networks from an older version of this script lack IPv6
ensure_network() {
  local name="$1" v4="$2" v6="$3"
  if [ "$(docker network inspect "$name" --format '{{.EnableIPv6}}' 2>/dev/null)" = false ]; then
    docker network rm "$name" >/dev/null
  fi
  docker network inspect "$name" >/dev/null 2>&1 ||
    docker network create --ipv6 --subnet "$v4" --subnet "$v6" "$name" >/dev/null
}

case "${1:-}" in
  up)
    docker rm -f "$NAME" >/dev/null 2>&1 || true
    ensure_network "$LAN" "172.$N.0.0/24" "fd$N::/64"
    ensure_network "$WAN" "172.$M.0.0/24" "fd$M::/64"
    # /proc/sys is read-only in the container: what /etc/sysctl.d would set on a real router goes here
    MSYS_NO_PATHCONV=1 docker create --name "$NAME" --cap-add NET_ADMIN --cap-add NET_RAW \
      --sysctl net.ipv6.conf.all.forwarding=1 --sysctl net.ipv6.conf.default.forwarding=1 \
      --sysctl net.netfilter.nf_conntrack_acct=1 \
      --network "$LAN" --ip "172.$N.0.2" --ip6 "fd$N::2" \
      -p "127.0.0.1:$PORT:80" -p "127.0.0.1:$TLS_PORT:443" \
      "openwrt/rootfs:x86-64-v$V" /sbin/init >/dev/null
    docker network connect --ip "172.$M.0.2" --ip6 "fd$M::2" "$WAN" "$NAME"
    TMP="$(mktemp)"
    network_config >"$TMP"
    SRC="$TMP"
    command -v cygpath >/dev/null 2>&1 && SRC="$(cygpath -w "$TMP")"
    MSYS_NO_PATHCONV=1 docker cp "$SRC" "$NAME:/etc/config/network"
    rm -f "$TMP"
    docker start "$NAME" >/dev/null
    # Docker does not keep the order of a container's networks: if eth0 is the WAN link, swap the names
    LAN_MAC="$(docker inspect "$NAME" --format "{{(index .NetworkSettings.Networks \"$LAN\").MacAddress}}")"
    MSYS_NO_PATHCONV=1 docker exec "$NAME" sh -c "
      [ \"\$(cat /sys/class/net/eth0/address)\" = '$LAN_MAC' ] && exit 0
      sed -i -e 's/eth0/ethX/' -e 's/eth1/eth0/' -e 's/ethX/eth1/' /etc/config/network
      /etc/init.d/network restart" >/dev/null 2>&1 || true
    for _ in $(seq 1 60); do
      curl -sf -o /dev/null "http://127.0.0.1:$PORT/" && break
      sleep 1
    done
    MSYS_NO_PATHCONV=1 docker exec "$NAME" sh -c 'printf "routelink-test\nroutelink-test\n" | passwd root >/dev/null 2>&1'
    # a container cannot set the clock, so ntpd never reports a sync: with NTP off, routelinkd trusts
    # the clock right away instead of waiting (on a freshly booted CI runner) before writing to disk
    MSYS_NO_PATHCONV=1 docker exec "$NAME" sh -c 'uci set system.ntp.enabled=0 && uci commit system && /etc/init.d/sysntpd stop' >/dev/null 2>&1 || true
    echo "OpenWrt $V ready: http://127.0.0.1:$PORT (root / routelink-test)"
    ;;
  down)
    docker rm -f "$NAME" >/dev/null 2>&1 || true
    if [ "${2:-}" = all ]; then
      docker network rm "$LAN" "$WAN" >/dev/null 2>&1 || true
    fi
    ;;
  *)
    echo "usage: $0 up [version] | down [all]" >&2
    exit 2
    ;;
esac
