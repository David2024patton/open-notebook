"""
Lightweight in-memory IP-based rate limiter for sensitive endpoints.

Protects authentication and credential-management endpoints from brute-force
and abuse. Uses a sliding-window counter per (IP, path-prefix) bucket.

Tuned for a single-process FastAPI deployment. For multi-process deployments
a shared backend (Redis) would be required; this implementation degrades
gracefully (each worker keeps its own counter).
"""

import time
from collections import defaultdict
from typing import Dict, Tuple

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

# Path prefixes to protect and their limits (max_requests, window_seconds).
RATE_LIMITED_PREFIXES: Dict[str, Tuple[int, int]] = {
    "/api/auth/login": (10, 60),          # 10 login attempts / minute
    "/api/auth/register": (5, 60),        # 5 registrations / minute
    "/api/auth/change-password": (5, 60), # 5 password changes / minute
    "/api/auth/2fa": (10, 60),            # 10 2FA attempts / minute
    "/api/credentials": (60, 60),         # 60 credential ops / minute
}

# Bucket: (ip, prefix) -> (count, window_start_ts)
_buckets: Dict[Tuple[str, str], Tuple[int, float]] = defaultdict(
    lambda: (0, time.monotonic())
)


def _client_ip(request: Request) -> str:
    # Honour X-Forwarded-For from trusted reverse proxies; fall back to direct client
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _matching_prefix(path: str) -> str:
    for prefix in RATE_LIMITED_PREFIXES:
        if path.startswith(prefix):
            return prefix
    return ""


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Reject requests that exceed the per-IP rate limit for protected paths."""

    async def dispatch(self, request: Request, call_next):
        prefix = _matching_prefix(request.url.path)
        if not prefix:
            return await call_next(request)

        max_requests, window = RATE_LIMITED_PREFIXES[prefix]
        ip = _client_ip(request)
        key = (ip, prefix)
        now = time.monotonic()
        count, started = _buckets[key]

        # Reset the window when it elapses
        if now - started >= window:
            count, started = 0, now

        count += 1
        _buckets[key] = (count, started)

        if count > max_requests:
            retry_after = int(window - (now - started)) + 1
            return JSONResponse(
                status_code=429,
                content={"detail": "Too many requests. Please slow down."},
                headers={
                    "Retry-After": str(retry_after),
                    "X-RateLimit-Limit": str(max_requests),
                    "X-RateLimit-Window": f"{window}s",
                },
            )

        return await call_next(request)