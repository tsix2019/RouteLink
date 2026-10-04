#!/usr/bin/env bash
# Quick accuracy probe for the traffic lab: runs a command in the lab client and compares the client's
# IP-level byte counters with what routelinkd attributes to it.
# Usage: scripts/lab-measure.sh '<command run in the client>'
#   e.g. scripts/lab-measure.sh 'curl -s -o /dev/null http://172.41.0.10:8080/52428800'
set -euo pipefail
C=(docker exec routelink-lab-client)
R=(docker exec routelink-agent-owrt)
export MSYS_NO_PATHCONV=1

counters() { # rx_bytes rx_packets tx_bytes tx_packets
  "${C[@]}" sh -c 'd=/sys/class/net/eth0/statistics; echo $(cat $d/rx_bytes) $(cat $d/rx_packets) $(cat $d/tx_bytes) $(cat $d/tx_packets)'
}
mac() { "${C[@]}" cat /sys/class/net/eth0/address | tr a-f A-F; }
device_bytes() { # rx tx of the client in the last hour, all classes
  local now; now=$(date +%s)
  "${R[@]}" ubus call routelink summary "{\"start\":$((now - 3600)),\"end\":$((now + 60)),\"class\":\"all\",\"limit\":500}" |
    tr -d '\n\t ' | grep -o "\"mac\":\"$(mac)\",\"rx\":[0-9]*,\"tx\":[0-9]*" | sed 's/.*"rx":\([0-9]*\),"tx":\([0-9]*\)/\1 \2/' || echo "0 0"
}
settle() { # two fast samples so TIME_WAIT/closed flows are counted
  "${R[@]}" ubus call routelink live >/dev/null
  sleep 3
  "${R[@]}" ubus call routelink live >/dev/null
}

settle
read -r rx0 rp0 tx0 tp0 < <(counters)
read -r drx0 dtx0 < <(device_bytes)
"${C[@]}" sh -c "$1"
settle
read -r rx1 rp1 tx1 tp1 < <(counters)
read -r drx1 dtx1 < <(device_bytes)
truth_rx=$(((rx1 - rx0) - 14 * (rp1 - rp0)))
truth_tx=$(((tx1 - tx0) - 14 * (tp1 - tp0)))
got_rx=$((drx1 - drx0))
got_tx=$((dtx1 - dtx0))
err() { awk -v a="$1" -v b="$2" 'BEGIN { if (b == 0) print "n/a"; else printf "%.2f%%\n", (a - b) * 100 / b }'; }
echo "rx truth $truth_rx  plugin $got_rx  error $(err "$got_rx" "$truth_rx")"
echo "tx truth $truth_tx  plugin $got_tx  error $(err "$got_tx" "$truth_tx")"
