#!/usr/bin/env bash
# A LAN client and an "internet" server around the plugin test router (scripts/agent-router.sh),
# so that real traffic flows through the router's conntrack.
# Usage: scripts/traffic-lab.sh up|down
#
#   routelink-lab-client  LAN 172.40.0.10 / fd40::10, default route via the router
#   routelink-lab-server  WAN 172.41.0.10 / fd41::10
#     :8080  GET /<n> returns n bytes, POST discards the body (HTTP/1.1, IPv4 + IPv6);
#            LibreSpeed's garbage.php?ckSize=<MiB> and empty.php for the router-side speed test
#            POST /hook... receives push requests (/hook/fail answers 500, /hook/errcode a JSON error),
#            GET /hook lists them, DELETE /hook forgets them
#     :9000  accepts and holds TCP connections (for connection-count tests)
#     :53    DNS (UDP): every A / AAAA name is the server itself, names starting with "nx" do not exist
#
# With RL_AGENT_NAME / RL_AGENT_NET (a second router, see agent-router.sh) the lab joins that router:
# <prefix>-lab-client and <prefix>-lab-server on 172.<n> / 172.<n+1>.
set -euo pipefail
PREFIX="${RL_AGENT_NAME:-routelink-agent}"
N="${RL_AGENT_NET:-40}"
M=$((N + 1))
LAN="$PREFIX-lan"
WAN="$PREFIX-wan"
ROUTER="$PREFIX-owrt"
LAB="routelink-lab"
[ -n "${RL_AGENT_NAME:-}" ] && LAB="$PREFIX-lab"
CLIENT="$LAB-client"
SERVER="$LAB-server"
IMAGE="alpine:3.22"

SERVER_PY='
import http.server, json, os, socket, socketserver, threading, urllib.parse
NET = os.environ.get("LAB_NET", "41")
HOOKS = []
class H(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    def reply(self, code, body=b"", ctype="application/json"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def read_body(self, keep):
        data = []
        if "chunked" in self.headers.get("Transfer-Encoding", "").lower():
            # uclient-fetch --post-file sends chunks
            while True:
                n = int(self.rfile.readline().split(b";")[0].strip() or b"0", 16)
                if n == 0:
                    while self.rfile.readline().strip():
                        pass
                    break
                while n > 0:
                    d = self.rfile.read(min(n, 65536))
                    if not d:
                        return b"".join(data)
                    n -= len(d)
                    if keep:
                        data.append(d)
                self.rfile.readline()
        n = int(self.headers.get("Content-Length", 0))
        while n > 0:
            d = self.rfile.read(min(n, 65536))
            if not d:
                break
            n -= len(d)
            if keep:
                data.append(d)
        return b"".join(data)
    def do_GET(self):
        url = urllib.parse.urlsplit(self.path)
        if url.path == "/hook":
            return self.reply(200, json.dumps(HOOKS).encode())
        if url.path.endswith("/garbage.php"):
            n = min(int(urllib.parse.parse_qs(url.query).get("ckSize", ["4"])[0]), 1024) << 20
        elif url.path.endswith("/empty.php"):
            n = 0
        else:
            n = int(url.path.strip("/") or 0)
        self.send_response(200)
        self.send_header("Content-Length", str(n))
        self.end_headers()
        chunk = b"x" * 65536
        while n > 0:
            k = min(n, 65536)
            self.wfile.write(chunk[:k])
            n -= k
    def do_POST(self):
        hook = self.path.startswith("/hook")
        data = self.read_body(hook)
        if hook:
            # webhook receiver for push tests: GET /hook lists what came, DELETE /hook forgets it
            HOOKS.append({"path": self.path, "type": self.headers.get("Content-Type", ""), "body": data.decode("utf-8", "replace")})
            if self.path.startswith("/hook/fail"):
                return self.reply(500, b"failed")
            if self.path.startswith("/hook/errcode"):
                return self.reply(200, b"{\"errcode\":40001,\"errmsg\":\"invalid webhook key\"}")
            return self.reply(200, b"{\"errcode\":0,\"errmsg\":\"ok\"}")
        self.send_response(200 if self.path.split("?")[0].endswith("/empty.php") else 204)
        self.send_header("Content-Length", "0")
        self.end_headers()
    def do_DELETE(self):
        HOOKS.clear()
        self.reply(204)
    def log_message(self, *a):
        pass
class S(socketserver.ThreadingMixIn, http.server.HTTPServer):
    address_family = socket.AF_INET6
    daemon_threads = True
    allow_reuse_address = True
    request_queue_size = 128
def hold():
    s = socket.socket(socket.AF_INET6)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s.bind(("::", 9000))
    s.listen(8192)
    conns = []
    while True:
        conns.append(s.accept()[0])
def dns():
    # every A / AAAA name is the server itself, names starting with nx do not exist
    s = socket.socket(socket.AF_INET6, socket.SOCK_DGRAM)
    s.bind(("::", 53))
    while True:
        q, peer = s.recvfrom(512)
        i, labels = 12, []
        while i < len(q) and q[i]:
            labels.append(q[i + 1:i + 1 + q[i]].decode("ascii", "replace"))
            i += q[i] + 1
        if len(q) < i + 5:
            continue
        qtype = int.from_bytes(q[i + 1:i + 3], "big")
        name = ".".join(labels).lower()
        ans, rcode = b"", 0
        if name.startswith("nx"):
            rcode = 3
        elif qtype in (1, 28):
            rdata = socket.inet_pton(socket.AF_INET, "172.%s.0.10" % NET) if qtype == 1 else socket.inet_pton(socket.AF_INET6, "fd%s::10" % NET)
            ans = b"\xc0\x0c" + q[i + 1:i + 5] + (60).to_bytes(4, "big") + len(rdata).to_bytes(2, "big") + rdata
        hdr = q[:2] + bytes([0x81, 0x80 | rcode]) + b"\x00\x01" + (b"\x00\x01" if ans else b"\x00\x00") + b"\x00\x00\x00\x00"
        s.sendto(hdr + q[12:i + 5] + ans, peer)
threading.Thread(target=hold, daemon=True).start()
threading.Thread(target=dns, daemon=True).start()
S(("::", 8080), H).serve_forever()
'

run() {
  MSYS_NO_PATHCONV=1 docker "$@"
}

case "${1:-}" in
  up)
    docker inspect "$ROUTER" >/dev/null 2>&1 || { echo "start scripts/agent-router.sh up first" >&2; exit 1; }
    run rm -f "$CLIENT" "$SERVER" >/dev/null 2>&1 || true
    # the lab networks are eth0; Docker's gateway on them (.1) gives internet access for apk
    run create --name "$SERVER" --cap-add NET_ADMIN --network "$WAN" --ip "172.$M.0.10" --ip6 "fd$M::10" \
      "$IMAGE" sleep infinity >/dev/null
    run create --name "$CLIENT" --cap-add NET_ADMIN --network "$LAN" --ip "172.$N.0.10" --ip6 "fd$N::10" \
      "$IMAGE" sleep infinity >/dev/null
    run start "$SERVER" "$CLIENT" >/dev/null
    run exec "$SERVER" apk add -q python3 >/dev/null
    run exec "$CLIENT" apk add -q python3 curl >/dev/null
    # from here on the client reaches the server only through the router
    run exec "$SERVER" sh -c "ip route replace 172.$N.0.0/24 via 172.$M.0.2 && ip -6 route replace fd$N::/64 via fd$M::2"
    run exec "$CLIENT" sh -c "ip route replace default via 172.$N.0.2 && ip -6 route replace default via fd$N::2"
    run exec -d -e LAB_NET="$M" "$SERVER" python3 -c "$SERVER_PY"
    for _ in $(seq 1 20); do
      run exec "$CLIENT" curl -sf -o /dev/null "http://172.$M.0.10:8080/10" && break
      sleep 1
    done
    run exec "$CLIENT" curl -sf -o /dev/null "http://[fd$M::10]:8080/10" || echo "warning: IPv6 path not working" >&2
    echo "lab ready: client 172.$N.0.10 / fd$N::10 -> server 172.$M.0.10 / fd$M::10"
    ;;
  down)
    run rm -f "$CLIENT" "$SERVER" >/dev/null 2>&1 || true
    ;;
  *)
    echo "usage: $0 up|down" >&2
    exit 2
    ;;
esac
