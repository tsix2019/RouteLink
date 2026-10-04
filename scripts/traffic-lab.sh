#!/usr/bin/env bash
# A LAN client and an "internet" server around the plugin test router (scripts/agent-router.sh),
# so that real traffic flows through the router's conntrack.
# Usage: scripts/traffic-lab.sh up|down
#
#   routelink-lab-client  LAN 172.40.0.10 / fd40::10, default route via the router
#   routelink-lab-server  WAN 172.41.0.10 / fd41::10
#     :8080  GET /<n> returns n bytes, POST discards the body (HTTP/1.1, IPv4 + IPv6)
#     :9000  accepts and holds TCP connections (for connection-count tests)
set -euo pipefail
LAN="routelink-agent-lan"
WAN="routelink-agent-wan"
CLIENT="routelink-lab-client"
SERVER="routelink-lab-server"
IMAGE="alpine:3.22"

SERVER_PY='
import http.server, socket, socketserver, threading
class H(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    def do_GET(self):
        n = int(self.path.strip("/") or 0)
        self.send_response(200)
        self.send_header("Content-Length", str(n))
        self.end_headers()
        chunk = b"x" * 65536
        while n > 0:
            k = min(n, 65536)
            self.wfile.write(chunk[:k])
            n -= k
    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        while n > 0:
            d = self.rfile.read(min(n, 65536))
            if not d:
                break
            n -= len(d)
        self.send_response(204)
        self.send_header("Content-Length", "0")
        self.end_headers()
    def log_message(self, *a):
        pass
class S(socketserver.ThreadingMixIn, http.server.HTTPServer):
    address_family = socket.AF_INET6
    daemon_threads = True
    allow_reuse_address = True
def hold():
    s = socket.socket(socket.AF_INET6)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s.bind(("::", 9000))
    s.listen(8192)
    conns = []
    while True:
        conns.append(s.accept()[0])
threading.Thread(target=hold, daemon=True).start()
S(("::", 8080), H).serve_forever()
'

run() {
  MSYS_NO_PATHCONV=1 docker "$@"
}

case "${1:-}" in
  up)
    docker inspect routelink-agent-owrt >/dev/null 2>&1 || { echo "start scripts/agent-router.sh up first" >&2; exit 1; }
    run rm -f "$CLIENT" "$SERVER" >/dev/null 2>&1 || true
    # the lab networks are eth0; Docker's gateway on them (.1) gives internet access for apk
    run create --name "$SERVER" --cap-add NET_ADMIN --network "$WAN" --ip 172.41.0.10 --ip6 fd41::10 \
      "$IMAGE" sleep infinity >/dev/null
    run create --name "$CLIENT" --cap-add NET_ADMIN --network "$LAN" --ip 172.40.0.10 --ip6 fd40::10 \
      "$IMAGE" sleep infinity >/dev/null
    run start "$SERVER" "$CLIENT" >/dev/null
    run exec "$SERVER" apk add -q python3 >/dev/null
    run exec "$CLIENT" apk add -q python3 curl >/dev/null
    # from here on the client reaches the server only through the router
    run exec "$SERVER" sh -c 'ip route replace 172.40.0.0/24 via 172.41.0.2 && ip -6 route replace fd40::/64 via fd41::2'
    run exec "$CLIENT" sh -c 'ip route replace default via 172.40.0.2 && ip -6 route replace default via fd40::2'
    run exec -d "$SERVER" python3 -c "$SERVER_PY"
    for _ in $(seq 1 20); do
      run exec "$CLIENT" curl -sf -o /dev/null http://172.41.0.10:8080/10 && break
      sleep 1
    done
    run exec "$CLIENT" curl -sf -o /dev/null "http://[fd41::10]:8080/10" || echo "warning: IPv6 path not working" >&2
    echo "lab ready: client 172.40.0.10 / fd40::10 -> server 172.41.0.10 / fd41::10"
    ;;
  down)
    run rm -f "$CLIENT" "$SERVER" >/dev/null 2>&1 || true
    ;;
  *)
    echo "usage: $0 up|down" >&2
    exit 2
    ;;
esac
