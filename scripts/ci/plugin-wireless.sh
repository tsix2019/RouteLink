#!/usr/bin/env bash
# Wireless sampling of the router plugin (plan P2 T6) on the QEMU router of scripts/ci/qemu-openwrt.sh,
# booted with HWSIM_RADIOS=4: installs routelinkd from <pkg-dir>, joins the RouteLink network (radio0,
# 2.4 GHz channel 1) with wpa_supplicant on the spare fourth radio, and checks that
#   - info reports the ap role and the wifi module,
#   - stations lists the station with a plausible signal, devices has its interface,
#   - survey has busy time for the radios after a scan,
#   - signal has minute data for it,
#   - leaving gives a wifi_disconnect event (value 2412) after a wifi_connect one.
# Usage: scripts/ci/plugin-wireless.sh <pkg-dir>   (routelinkd_*.ipk or routelinkd-*.apk)
set -euo pipefail
PKGS="$1"

ssh_root() {
  sshpass -p routelink-test ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR \
    -o PubkeyAuthentication=no -p 18022 root@127.0.0.1 "$@"
}

PKG="$(ls "$PKGS"/routelinkd_*.ipk "$PKGS"/routelinkd-[0-9]*.apk 2>/dev/null | head -n1 || true)"
[ -n "$PKG" ] || { echo "no routelinkd package in $PKGS" >&2; exit 1; }
# OpenWrt has no scp server: stream the file over ssh
ssh_root "cat > /tmp/$(basename "$PKG")" <"$PKG"

ssh_root "PKG=/tmp/$(basename "$PKG") sh -s" <<'REMOTE'
set -e
fail() {
  echo "FAIL: $*"
  echo "--- routelink log"; logread | grep -i routelink | tail -30
  echo "--- iw dev"; iw dev 2>&1 | head -40
  echo "--- stations"; ubus call routelink stations 2>&1 | head -60
  exit 1
}

# the package lists live in /tmp and are gone after the reboot of the setup
if command -v apk >/dev/null 2>&1; then
  apk update >/dev/null
  apk add --allow-untrusted "$PKG" iw
else
  opkg update >/dev/null
  opkg install "$PKG" iw
fi
ubus -t 15 wait_for routelink || fail "routelinkd did not register on ubus"
# role detection runs right after the daemon connected to ubus
for i in $(seq 1 20); do
  ubus call routelink info | jsonfilter -e '@.modules[*]' | grep -qx wifi && break
  sleep 1
done
ubus call routelink info | jsonfilter -e '@.roles[*]' | grep -qx ap || fail "info has no ap role"
ubus call routelink info | jsonfilter -e '@.modules[*]' | grep -qx wifi || fail "wifi module is not running"
[ -f /var/run/routelink/ap ] || fail "no LuCI menu marker for the ap role"

# the spare radio is the phy without an AP interface; 23.05 leaves hwsim's default wlanN on it
ifaces_of() { iw dev | awk -v want="phy#$1" '/^phy#/ { cur = $1 } cur == want && $1 == "Interface" { print $2 }'; }
STA_PHY=""
for p in /sys/class/ieee80211/*; do
  idx="$(cat "$p/index")"
  iw dev | awk -v want="phy#$idx" '/^phy#/ { cur = $1 } cur == want && /type AP/ { ap = 1 } END { exit !ap }' && continue
  STA_PHY="$(basename "$p")"
  for i in $(ifaces_of "$idx"); do iw dev "$i" del 2>/dev/null || true; done
  break
done
[ -n "$STA_PHY" ] || fail "no spare radio (HWSIM_RADIOS=4?)"
iw phy "$STA_PHY" interface add rlsta0 type managed
ip link set rlsta0 up
cat >/tmp/rlsta.conf <<'EOF'
network={
	ssid="RouteLink"
	key_mgmt=WPA-PSK
	psk="routelink-test"
	scan_freq=2412
}
EOF
wpa_supplicant -B -D nl80211 -i rlsta0 -c /tmp/rlsta.conf -P /tmp/rlsta.pid
MAC="$(tr a-f A-F </sys/class/net/rlsta0/address)"
for i in $(seq 1 40); do
  iw dev rlsta0 link | grep -q '^Connected' && break
  sleep 1
done
iw dev rlsta0 link | grep -q '^Connected' || fail "station $MAC did not join RouteLink"
echo "station $MAC joined RouteLink on $STA_PHY"

# stations: sampled every 10 s (and a second after NEW_STATION)
sig=""
for i in $(seq 1 30); do
  sig="$(ubus call routelink stations | jsonfilter -e "@.stations[@.mac='$MAC'].signal" 2>/dev/null || true)"
  [ -n "$sig" ] && break
  sleep 1
done
[ -n "$sig" ] || fail "$MAC is not in stations"
[ "$sig" -lt 0 ] && [ "$sig" -gt -100 ] || fail "implausible signal $sig dBm"
freq="$(ubus call routelink stations | jsonfilter -e "@.stations[@.mac='$MAC'].freq")"
[ "$freq" = 2412 ] || fail "station frequency $freq, expected 2412"
ubus call routelink stations | jsonfilter -e "@.interfaces[@.ssid='RouteLink'].stations" | grep -qx 1 ||
  fail "the RouteLink interface does not count the station"
ubus call routelink devices | jsonfilter -e "@.devices[@.mac='$MAC'].ifname" | grep -q . ||
  fail "devices has no interface for $MAC"
echo "stations: $MAC at $sig dBm on $freq MHz"
# a live lease switches to 1 s samples
ubus call routelink stations '{"live":true}' | jsonfilter -e '@.interval' | grep -qx 1 || fail "live lease not granted"

# survey: mac80211_hwsim only reports channel time for channels it scanned
ubus call iwinfo scan '{"device":"phy0-ap0"}' >/dev/null 2>&1 ||
  iw dev "$(ubus call routelink stations | jsonfilter -e "@.interfaces[@.ssid='RouteLink'].ifname")" scan ap-force >/dev/null 2>&1 || true
busy=""
for i in $(seq 1 75); do
  s="$(ubus call routelink survey)"
  busy="$(echo "$s" | jsonfilter -e '@.radios[*].busy_ms' -e '@.channels[*].busy_pct' 2>/dev/null | head -n1 || true)"
  [ -n "$busy" ] && break
  sleep 1
done
[ -n "$busy" ] || { ubus call routelink survey; fail "survey has no busy time"; }
echo "survey: $(ubus call routelink survey | jsonfilter -e '@.radios[*].freq' | tr '\n' ' ')radios, busy data present"

# signal: minute tier (the range starts more than 10 minutes ago)
now="$(date +%s)"
h="$(ubus call routelink signal "{\"mac\":\"$MAC\",\"start\":$((now - 3600)),\"end\":$((now + 60))}")"
[ "$(echo "$h" | jsonfilter -e '@.tier')" = minute ] || fail "signal tier $(echo "$h" | jsonfilter -e '@.tier')"
echo "$h" | jsonfilter -e '@.points[*][1]' | grep -q '^-' || { echo "$h" | tail -20; fail "no minute signal data"; }
# live tier: recent range
h="$(ubus call routelink signal "{\"mac\":\"$MAC\",\"start\":$((now - 120)),\"end\":$((now + 60))}")"
[ "$(echo "$h" | jsonfilter -e '@.tier')" = live ] || fail "recent signal tier $(echo "$h" | jsonfilter -e '@.tier')"
echo "signal: minute and live data"

# leaving: DEL_STATION ends the association right away
kill "$(cat /tmp/rlsta.pid)"
ev=""
for i in $(seq 1 20); do
  ev="$(ubus call routelink events "{\"types\":[\"wifi_disconnect\"],\"mac\":\"$MAC\"}" | jsonfilter -e '@.events[0].value' 2>/dev/null || true)"
  [ -n "$ev" ] && break
  sleep 1
done
[ "$ev" = 2412 ] || fail "no wifi_disconnect event for $MAC (value '$ev')"
ubus call routelink events "{\"types\":[\"wifi_connect\"],\"mac\":\"$MAC\"}" | jsonfilter -e '@.events[0].value' | grep -qx 2412 ||
  fail "no wifi_connect event for $MAC"
[ -z "$(ubus call routelink stations | jsonfilter -e "@.stations[@.mac='$MAC'].mac" 2>/dev/null || true)" ] ||
  fail "$MAC is still listed after leaving"
echo "events: wifi_connect and wifi_disconnect at 2412 MHz"

iw dev rlsta0 del 2>/dev/null || true
echo "plugin wireless checks passed"
REMOTE
