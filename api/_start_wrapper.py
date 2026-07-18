#!/usr/bin/env python3
"""Startup wrapper: runs uvicorn; on exit serves the captured traceback on 5055."""
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT = 5055
LOG = []


class _Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        body = ("OPEN NOTEBOOK API FAILED TO START\n\n=== captured output ===\n"
                + "".join(LOG)).encode("utf-8", "replace")
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


def _serve():
    HTTPServer(("0.0.0.0", PORT), _Handler).serve_forever()


def main():
    cmd = [sys.executable, "-m", "uvicorn", "api.main:app",
           "--host", "0.0.0.0", "--port", str(PORT)]
    proc = subprocess.run(cmd, cwd="/app", text=True,
                          stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    LOG.append(proc.stdout or "")
    LOG.append(f"\n=== uvicorn exited with code {proc.returncode} ===\n")
    sys.stderr.write("".join(LOG))
    sys.stderr.flush()
    threading.Thread(target=_serve, daemon=True).start()
    while True:
        time.sleep(3600)


if __name__ == "__main__":
    main()