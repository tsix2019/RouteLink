#!/usr/bin/env bash
# Boots an official OpenWrt x86-64 image in QEMU for the integration tests (plan T60). Linux + KVM only.
# Usage: scripts/ci/qemu-openwrt.sh <version> [workdir]
#   LAN (eth0) 192.168.1.1, forwarded to 127.0.0.1:18080 (http), :18443 (https), :18022 (ssh)
#   WAN (eth1) user-mode NAT with internet access for the package manager
# Afterwards: two mac80211_hwsim radios (SSID RouteLink / RouteLink-5G), luci-app-wol, and
# root password routelink-test.
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

echo "waiting for LuCI..."
for _ in $(seq 1 120); do
  curl -sf -o /dev/null http://127.0.0.1:18080/ && break
  sleep 1
done
curl -sf -o /dev/null http://127.0.0.1:18080/ || { echo "OpenWrt $V did not come up" >&2; exit 1; }

# A fresh image has no root password; dropbear accepts the empty one.
ssh_root() {
  sshpass -p '' ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR \
    -o PubkeyAuthentication=no -p 18022 root@127.0.0.1 "$@"
}
for _ in $(seq 1 30); do ssh_root true && break; sleep 2; done

ssh_root 'sh -s' <<'REMOTE'
set -e
# The WAN may take a moment to get its DHCP lease.
for i in $(seq 1 30); do ping -c1 -W2 downloads.openwrt.org >/dev/null 2>&1 && break; sleep 2; done
if command -v apk >/dev/null 2>&1; then
  apk update && apk add kmod-mac80211-hwsim wpad-basic-mbedtls luci-app-wol
else
  opkg update && opkg install kmod-mac80211-hwsim wpad-basic-mbedtls luci-app-wol
fi
# The radios appear once the module is loaded and netifd has noticed them (25.12 is slower).
modprobe mac80211_hwsim 2>/dev/null || true
sleep 3
rm -f /etc/config/wireless
for i in $(seq 1 10); do wifi config >/dev/null 2>&1 && [ -s /etc/config/wireless ] && break; sleep 3; done
for r in radio0 radio1; do uci -q set "wireless.$r.disabled=0" || true; done
uci -q set wireless.default_radio0.ssid=RouteLink || true
uci -q set wireless.default_radio1.ssid=RouteLink-5G || true
uci commit wireless
# netifd must re-read the config before `wifi up` knows the radios (25.12 answers "Not found" otherwise).
ubus call network reload 2>/dev/null || true
sleep 3
wifi up 2>/dev/null || wifi 2>/dev/null || true
for i in $(seq 1 20); do
  ubus call network.wireless status 2>/dev/null | grep -q '"up": true' && break
  sleep 2
done
ubus call network.wireless status 2>/dev/null | grep -E '"(radio[0-9]|up)"' || echo "warning: radios not up"
printf 'routelink-test\nroutelink-test\n' | passwd root >/dev/null
REMOTE
sleep 10
echo "OpenWrt $V ready on http://127.0.0.1:18080 (root / routelink-test)"
