#!/usr/bin/env python3
"""Local servers for the native self-test (plan T59).

  127.0.0.1:8098  HTTP: /  /redirect (302)  /cookie (Set-Cookie)  /echo-cookie (echoes the Cookie header)
  127.0.0.1:8443  HTTPS with a throw-away self-signed certificate (fingerprint in <out>/fp.txt)
  127.0.0.1:8099  POST /report -> <out>/selftest-report.json

Usage: selftest-servers.py <out-dir>   (runs until killed)
"""
import hashlib
import http.server
import os
import ssl
import subprocess
import sys
import threading

OUT = sys.argv[1] if len(sys.argv) > 1 else ".selftest"
os.makedirs(OUT, exist_ok=True)
CERT, KEY = os.path.join(OUT, "cert.pem"), os.path.join(OUT, "key.pem")


class TestHandler(http.server.BaseHTTPRequestHandler):
    # Keep-alive like uhttpd, so the client's connection reuse is exercised too.
    protocol_version = "HTTP/1.1"

    def _send(self, status, body=b"", headers=None):
        self.send_response(status)
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/redirect":
            self._send(302, headers={"Location": "/"})
        elif self.path == "/cookie":
            self._send(200, b"cookie set", {"Set-Cookie": "sid=routelink; Path=/"})
        elif self.path == "/echo-cookie":
            self._send(200, self.headers.get("Cookie", "").encode())
        else:
            self._send(200, b"ok")

    def log_message(self, *args):
        pass


class ReportHandler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        with open(os.path.join(OUT, "selftest-report.json"), "wb") as f:
            f.write(body)
        self.send_response(204)
        self.end_headers()

    def log_message(self, *args):
        pass


def serve(server):
    threading.Thread(target=server.serve_forever, daemon=True).start()


subprocess.run(
    ["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2",
     "-subj", "/CN=routelink-selftest", "-keyout", KEY, "-out", CERT],
    check=True, capture_output=True,
)
der = ssl.PEM_cert_to_DER_cert(open(CERT).read())
with open(os.path.join(OUT, "fp.txt"), "w") as f:
    f.write(hashlib.sha256(der).hexdigest())

serve(http.server.ThreadingHTTPServer(("127.0.0.1", 8098), TestHandler))
https = http.server.ThreadingHTTPServer(("127.0.0.1", 8443), TestHandler)
ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
ctx.load_cert_chain(CERT, KEY)
https.socket = ctx.wrap_socket(https.socket, server_side=True)
serve(https)
report = http.server.ThreadingHTTPServer(("127.0.0.1", 8099), ReportHandler)
print("selftest servers ready", flush=True)
report.serve_forever()
