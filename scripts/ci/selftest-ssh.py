#!/usr/bin/env python3
"""SSH server for the native self-test (M4 T3), offering what OpenWrt's dropbear offers: an ed25519 host key,
curve25519 key exchange, aes128-ctr or chacha20-poly1305 (no AES-GCM) and hmac-sha2-256.

  <host>:2222       user root, password routelink-test; keys POSTed to :8097/authorize are accepted too
  exec              "echo <text>", "exit <n>"
  shell (with PTY)  prompt "root@selftest:~# "; "echo <text>", "stty size" (rows cols), "exit"

Writes <out>/ssh-fp.txt: the host key's fingerprint as OpenSSH prints it (SHA256:…).

Not dropbear itself: on macOS dropbear cannot check passwords (they are not in the passwd database).

Usage: selftest-ssh.py <out-dir> [host]   (runs until killed; needs `pip install asyncssh`)
"""
import asyncio
import http.server
import os
import sys
import threading
import traceback

import asyncssh

OUT = sys.argv[1] if len(sys.argv) > 1 else ".selftest"
HOST = sys.argv[2] if len(sys.argv) > 2 else "127.0.0.1"
PASSWORD = "routelink-test"
PROMPT = "root@selftest:~# "
AUTHORIZED = set()


class Server(asyncssh.SSHServer):
    def begin_auth(self, username):
        return True

    def password_auth_supported(self):
        return True

    def validate_password(self, username, password):
        return username == "root" and password == PASSWORD

    def public_key_auth_supported(self):
        return True

    def validate_public_key(self, username, key):
        blob = key.export_public_key("openssh").decode().split()[1]
        return username == "root" and blob in AUTHORIZED


def run_command(command):
    """(output, exit status) of the few commands the checks use."""
    if command.startswith("echo "):
        return command[5:] + "\n", 0
    if command.startswith("exit "):
        return "", int(command[5:])
    return f"sh: {command.split()[0] if command.split() else command}: not found\n", 127


async def handle(process):
    try:
        await serve(process)
    except Exception:  # shown in the CI log, else asyncssh drops it silently
        traceback.print_exc()
        process.exit(1)


async def serve(process):
    if process.command is not None:
        output, status = run_command(process.command)
        process.stdout.write(output)
        process.exit(status)
        return
    process.stdout.write(PROMPT)
    while True:
        try:
            line = await process.stdin.readline()
        except asyncssh.TerminalSizeChanged:
            continue
        except asyncssh.BreakReceived:
            break
        if not line:
            break
        line = line.rstrip("\r\n")
        if line == "exit":
            break
        # The PTY's line editor turns \n into \r\n.
        if line == "stty size":
            cols, rows, _, _ = process.get_terminal_size()
            process.stdout.write(f"{rows} {cols}\n")
        elif line:
            output, _ = run_command(line)
            process.stdout.write(output)
        process.stdout.write(PROMPT)
    process.exit(0)


class Authorize(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        line = self.rfile.read(int(self.headers.get("Content-Length", "0"))).decode().split()
        if len(line) >= 2 and line[0] == "ssh-ed25519":
            AUTHORIZED.add(line[1])
            self.send_response(204)
        else:
            self.send_response(400)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def log_message(self, *args):
        pass


async def main():
    os.makedirs(OUT, exist_ok=True)
    key = asyncssh.generate_private_key("ssh-ed25519")
    with open(os.path.join(OUT, "ssh-fp.txt"), "w") as f:
        f.write(key.get_fingerprint("sha256"))
    authorize = http.server.ThreadingHTTPServer((HOST, 8097), Authorize)
    threading.Thread(target=authorize.serve_forever, daemon=True).start()
    await asyncssh.create_server(
        Server, HOST, 2222,
        server_host_keys=[key],
        process_factory=handle,
        kex_algs=["curve25519-sha256", "curve25519-sha256@libssh.org"],
        encryption_algs=["chacha20-poly1305@openssh.com", "aes128-ctr", "aes256-ctr"],
        mac_algs=["hmac-sha2-256"],
        compression_algs=["none"],
    )
    print("ssh ready", flush=True)
    await asyncio.Event().wait()


asyncio.run(main())
