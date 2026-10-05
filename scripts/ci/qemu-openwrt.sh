#!/usr/bin/env bash
# Boots an official OpenWrt x86-64 image in QEMU for the integration tests (plan T60). Linux + KVM only.
# Usage: scripts/ci/qemu-openwrt.sh <version> [workdir]
#   LAN (eth0) 192.168.1.1, forwarded to 127.0.0.1:18080 (http), :18443 (https), :18022 (ssh)
#   WAN (eth1) user-mode NAT with internet access for the package manager
# Afterwards: three mac80211_hwsim radios — RouteLink (2.4 GHz), RouteLink-5G (5 GHz) and a
# "Neighbor-Test" AP for scans — luci-app-wol, and root password routelink-test.
set -euo pipefail
V="$1"
WORK="${2:-$PWD/.qemu}"
mkdir -p "$WORK"
IMG="$WORK/openwrt-$V.img"
URL="https://downloads.openwrt.org/releases/$V/targets/x86/64/openwrt-$V-x86-64-generic-squashfs-combined.img.gz"

if [ ! -f "$IMG" ]; then
  curl -fsSL --retry 3 -o "$IMG.gz" "$URL"
  # OpenWrt images carry trailing data: gunzip warns and exits 2, which is fine.
  gunzip -c "$IMG.gz" > "$IMG" || [ $? -eq 2 ]
fi
cp "$IMG" "$WORK/run.img"

qemu-system-x86_64 -enable-kvm -cpu host -m 512 -smp 2 -display none -daemonize \
  -pidfile "$WORK/qemu.pid" \
  -drive "file=$WORK/run.img,format=raw,if=virtio" \
  -netdev "user,id=lan,net=192.168.1.0/24,host=192.168.1.2,hostfwd=tcp:127.0.0.1:18080-192.168.1.1:80,hostfwd=tcp:127.0.0.1:18443-192.168.1.1:443,hostfwd=tcp:127.0.0.1:18022-192.168.1.1:22" \
  -device virtio-net-pci,netdev=lan \
  -netdev user,id=wan -device virtio-net-pci,netdev=wan \
  -serial "file:$WORK/serial.log"

wait_for_luci() {
  for _ in $(seq 1 180); do
    curl -sf -o /dev/null http://127.0.0.1:18080/ && return 0
    sleep 1
  done
  echo "OpenWrt $V did not come up" >&2
  exit 1
}

# A fresh image has no root password; dropbear accepts the empty one until the end of phase 2.
ssh_root() {
  sshpass -p '' ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR \
    -o PubkeyAuthentication=no -p 18022 root@127.0.0.1 "$@"
}
wait_for_ssh() {
  for _ in $(seq 1 60); do ssh_root true 2>/dev/null && return 0; sleep 2; done
  echo "no SSH on OpenWrt $V" >&2
  exit 1
}

echo "waiting for LuCI..."
wait_for_luci
wait_for_ssh

# Phase 1: packages and three hwsim radios from boot on, then a reboot: netifd only picks up the
# wireless handler that the packages install when it starts.
ssh_root 'sh -s' <<'REMOTE'
set -e
# The WAN may take a moment to get its DHCP lease.
for i in $(seq 1 30); do ping -c1 -W2 downloads.openwrt.org >/dev/null 2>&1 && break; sleep 2; done
if command -v apk >/dev/null 2>&1; then
  apk update && apk add kmod-mac80211-hwsim wpad-basic-mbedtls luci-app-wol
else
  opkg update && opkg install kmod-mac80211-hwsim wpad-basic-mbedtls luci-app-wol
fi
found=0
for f in /etc/modules.d/*hwsim*; do
  [ -f "$f" ] || continue
  echo 'mac80211_hwsim radios=3' > "$f"
  found=1
done
[ "$found" = 1 ] || echo 'mac80211_hwsim radios=3' > /etc/modules.d/99-mac80211-hwsim
rm -f /etc/config/wireless
sync
(sleep 1; reboot) >/dev/null 2>&1 &
REMOTE

sleep 15
echo "waiting for the reboot..."
wait_for_luci
wait_for_ssh

# Phase 2: radio configuration. `wifi config` would choose 6 GHz for hwsim radios, where an open
# network can't start, so bands, channels and WPA2 keys are set explicitly.
ssh_root 'sh -s' <<'REMOTE'
set -e
for i in $(seq 1 15); do wifi config >/dev/null 2>&1; [ -s /etc/config/wireless ] && break; sleep 2; done
setup_radio() { # radio band channel htmode ssid
  uci -q set "wireless.$1.disabled=0"
  uci -q set "wireless.$1.band=$2"
  uci -q set "wireless.$1.channel=$3"
  uci -q set "wireless.$1.htmode=$4"
  uci -q set "wireless.$1.country=US"
  uci -q set "wireless.default_$1.ssid=$5"
  uci -q set "wireless.default_$1.encryption=psk2"
  uci -q set "wireless.default_$1.key=routelink-test"
}
setup_radio radio0 2g 1 HT20 RouteLink || true
setup_radio radio1 5g 36 VHT80 RouteLink-5G || true
setup_radio radio2 2g 11 HT20 Neighbor-Test || true
uci commit wireless
wifi up 2>/dev/null || wifi 2>/dev/null || true
# Up means an AP interface exists, not just a radio marked up.
for i in $(seq 1 30); do
  ubus call network.wireless status 2>/dev/null | grep -q '"ifname"' && break
  sleep 2
done
echo "--- hostapd objects"; ubus list 'hostapd.*' 2>&1 | head
if ! ubus call network.wireless status 2>/dev/null | grep -q '"ifname"'; then
  echo "warning: radios not up"
  echo "--- wireless status"; ubus call network.wireless status 2>&1 | head -80
  echo "--- iw dev"; iw dev 2>&1 | head -40
  echo "--- /etc/config/wireless"; cat /etc/config/wireless
  echo "--- handlers"; ls /lib/netifd/wireless/ 2>&1
  echo "--- log"; logread | grep -iE 'hostapd|netifd|wifi|mac80211|hwsim|wpa' | tail -60
fi
printf 'routelink-test\nroutelink-test\n' | passwd root >/dev/null
REMOTE
sleep 5
echo "OpenWrt $V ready on http://127.0.0.1:18080 (root / routelink-test)"
