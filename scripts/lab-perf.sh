#!/usr/bin/env bash
# routelinkd CPU and memory with many devices and connections (T20 of the P1 plan).
# Needs the traffic lab (scripts/traffic-lab.sh up). Usage: scripts/lab-perf.sh [devices] [connections] [seconds]
set -euo pipefail
export MSYS_NO_PATHCONV=1
DEVICES="${1:-50}"
CONNS="${2:-5000}"
SECS="${3:-120}"
C=(docker exec routelink-lab-client)
R=(docker exec routelink-agent-owrt)

echo "== $DEVICES macvlan devices on the client, $CONNS idle connections"
"${C[@]}" sh -c "
  for i in \$(seq 1 $DEVICES); do
    ip=172.40.0.\$((100 + i))
    ip link add mv\$i link eth0 type macvlan mode bridge 2>/dev/null || continue
    ip addr add \$ip/24 dev mv\$i
    ip link set mv\$i up
    ip rule add from \$ip table \$((100 + i))
    ip route add default via 172.40.0.2 dev mv\$i table \$((100 + i))
  done"
"${C[@]}" sh -c "cat > /tmp/hold.py <<'EOF'
import socket, sys, time
devices, conns = int(sys.argv[1]), int(sys.argv[2])
socks = []
for n in range(conns):
    s = socket.socket()
    s.bind(('172.40.0.%d' % (101 + n % devices), 0))
    s.connect(('172.41.0.10', 9000))
    socks.append(s)
print('holding', len(socks), flush=True)
time.sleep(100000)
EOF
ulimit -n 65536; nohup python3 /tmp/hold.py $DEVICES $CONNS >/tmp/hold.log 2>&1 &"
sleep 20
"${C[@]}" cat /tmp/hold.log
echo "conntrack entries: $("${R[@]}" cat /proc/sys/net/netfilter/nf_conntrack_count)"

measure() { # mode seconds
  local pid hz t0 t1
  pid=$("${R[@]}" pidof routelinkd)
  hz=100
  t0=$("${R[@]}" awk '{print $14 + $15}' /proc/$pid/stat)
  local end=$((SECONDS + $2))
  while [ $SECONDS -lt $end ]; do
    [ "$1" = live ] && "${R[@]}" ubus call routelink live >/dev/null
    sleep 10
  done
  t1=$("${R[@]}" awk '{print $14 + $15}' /proc/$pid/stat)
  local rss
  rss=$("${R[@]}" awk '/VmRSS/ {print $2}' /proc/$pid/status)
  awk -v m="$1" -v d="$((t1 - t0))" -v s="$2" -v hz=$hz -v rss="$rss" \
    'BEGIN { printf "%-6s CPU %.2f%% of one core, RSS %d kB\n", m, d / hz / s * 100, rss }'
}

echo "== devices seen by the daemon: $("${R[@]}" ubus call routelink devices | grep -c '"mac"')"
measure normal "$SECS"
measure live "$SECS"
"${C[@]}" sh -c 'pkill -f hold.py; for i in $(seq 1 '"$DEVICES"'); do ip link del mv$i 2>/dev/null; ip rule del table $((100 + i)) 2>/dev/null; done; true'
