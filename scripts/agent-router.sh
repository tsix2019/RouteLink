#!/usr/bin/env bash
# Disposable OpenWrt for the router plugin, separate from scripts/dev-router.sh so that both can run at
# the same time (other sessions use routelink-owrt on 172.30/31.0.0/24).
# Usage: scripts/agent-router.sh up [version] | down [all]
#   version defaults to 24.10.8; "down all" also removes the Docker networks.
#
# LAN 172.40.0.0/24 + fd40::/64 (router .2 / ::2), WAN 172.41.0.0/24 + fd41::/64.
# LuCI and ubus: http://127.0.0.1:18280 (root / routelink-test).
set -euo pipefail
V="${2:-24.10.8}"
NAME="routelink-agent-owrt"
LAN="routelink-agent-lan"
WAN="routelink-agent-wan"

network_config() {
  cat <<'EOF'
config interface 'loopback'
	option device 'lo'
	option proto 'static'
	option ipaddr '127.0.0.1'
	option netmask '255.0.0.0'

config globals 'globals'
	option ula_prefix 'fd40::/48'

config interface 'lan'
	option device 'eth0'
	option proto 'static'
	option ipaddr '172.40.0.2'
	option netmask '255.255.255.0'
	list ip6addr 'fd40::2/64'

config interface 'wan'
	option device 'eth1'
	option proto 'static'
	option ipaddr '172.41.0.2'
	option netmask '255.255.255.0'
	option gateway '172.41.0.1'
	list dns '1.1.1.1'

config interface 'wan6'
	option device 'eth1'
	option proto 'static'
	list ip6addr 'fd41::2/64'
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
    ensure_network "$LAN" 172.40.0.0/24 fd40::/64
    ensure_network "$WAN" 172.41.0.0/24 fd41::/64
    # /proc/sys is read-only in the container: what /etc/sysctl.d would set on a real router goes here
    MSYS_NO_PATHCONV=1 docker create --name "$NAME" --cap-add NET_ADMIN --cap-add NET_RAW \
      --sysctl net.ipv6.conf.all.forwarding=1 --sysctl net.ipv6.conf.default.forwarding=1 \
      --sysctl net.netfilter.nf_conntrack_acct=1 \
      --network "$LAN" --ip 172.40.0.2 --ip6 fd40::2 \
      -p 127.0.0.1:18280:80 -p 127.0.0.1:18643:443 \
      "openwrt/rootfs:x86-64-v$V" /sbin/init >/dev/null
    docker network connect --ip 172.41.0.2 --ip6 fd41::2 "$WAN" "$NAME"
    TMP="$(mktemp)"
    network_config >"$TMP"
    SRC="$TMP"
    command -v cygpath >/dev/null 2>&1 && SRC="$(cygpath -w "$TMP")"
    MSYS_NO_PATHCONV=1 docker cp "$SRC" "$NAME:/etc/config/network"
    rm -f "$TMP"
    docker start "$NAME" >/dev/null
    for _ in $(seq 1 60); do
      curl -sf -o /dev/null http://127.0.0.1:18280/ && break
      sleep 1
    done
    MSYS_NO_PATHCONV=1 docker exec "$NAME" sh -c 'printf "routelink-test\nroutelink-test\n" | passwd root >/dev/null 2>&1'
    echo "OpenWrt $V ready: http://127.0.0.1:18280 (root / routelink-test)"
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
