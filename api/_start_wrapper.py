#!/usr/bin/env python3
"""
Startup wrapper for the Open Notebook API.

Runs uvicorn for `api.main:app`. If uvicorn exits with a non-zero status
(the app failed to import or crashed at startup), this wrapper starts a
tiny HTTP server on the same port (5055) that returns the captured
stderr/traceback as plain text. This makes startup failures visible over
HTTP (e.g. through the frontend proxy) when SSH access to container logs
is unavailable.
"""
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT = 5055
LOG = []


class _Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        body = (
            "OPEN NOTEBOOK API FAILED TO START\n\n"
            + "=== captured output ===\n"
            + "".join(LOG)
        ).encode("utf-8", "replace")
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


def _serve():
    srv = HTTPServer(("0.0.0.0", PORT), _Handler)
    srv.serve_forever()


def main():
    cmd = [
        sys.executable, "-m", "uvicorn",
        "api.main:app",
        "--host", "0.0.0.0",
        "--port", str(PORT),
    ]
    proc = subprocess.run(cmd, cwd="/app", text=True,
                          stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    out = proc.stdout or ""
    LOG.append(out)
    LOG.append(f"\n=== uvicorn exited with code {proc.returncode} ===\n")
    sys.stderr.write(out)
    sys.stderr.flush()
    threading.Thread(target=_serve, daemon=False).start()
    # keep the process alive so the container (restart: always) does not loop
    # too fast; the http server handles requests.
    import time
    while True:
        time.sleep(3600)


if __name__ == "__main__":
    main()
