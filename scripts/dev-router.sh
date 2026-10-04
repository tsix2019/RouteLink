#!/usr/bin/env bash
# Disposable OpenWrt for local development (no Wi-Fi radios).
# Usage: scripts/dev-router.sh up|down [version]   (default version 24.10.8)
#
# netifd and firewall4 need NET_ADMIN. The container gets two Docker networks so netifd has a
# realistic LAN (eth0) and WAN (eth1); test/docker/network is copied in before the first boot.
set -euo pipefail
V="${2:-24.10.8}"
NAME="routelink-owrt"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

case "${1:-}" in
  up)
    docker rm -f "$NAME" >/dev/null 2>&1 || true
    docker network create --subnet 172.30.0.0/24 routelink-lan >/dev/null 2>&1 || true
    docker network create --subnet 172.31.0.0/24 routelink-wan >/dev/null 2>&1 || true
    MSYS_NO_PATHCONV=1 docker create --name "$NAME" --cap-add NET_ADMIN --cap-add NET_RAW \
      --network routelink-lan --ip 172.30.0.2 \
      -p 127.0.0.1:18080:80 -p 127.0.0.1:18443:443 \
      "openwrt/rootfs:x86-64-v$V" /sbin/init >/dev/null
    docker network connect --ip 172.31.0.2 routelink-wan "$NAME"
    SRC="$ROOT/test/docker/network"
    command -v cygpath >/dev/null 2>&1 && SRC="$(cygpath -w "$SRC")" # docker.exe needs a Windows path
    MSYS_NO_PATHCONV=1 docker cp "$SRC" "$NAME:/etc/config/network"
    docker start "$NAME" >/dev/null
    for _ in $(seq 1 60); do
      curl -sf -o /dev/null http://127.0.0.1:18080/ && break
      sleep 1
    done
    MSYS_NO_PATHCONV=1 docker exec "$NAME" sh -c 'printf "routelink-test\nroutelink-test\n" | passwd root >/dev/null 2>&1'
    echo "OpenWrt $V ready: http://127.0.0.1:18080 and https://127.0.0.1:18443 (root / routelink-test)"
    echo "From the Android emulator: http://10.0.2.2:18080"
    ;;
  down)
    docker rm -f "$NAME" >/dev/null 2>&1 || true
    ;;
  *)
    echo "usage: $0 up|down [version]" >&2
    exit 2
    ;;
esac
