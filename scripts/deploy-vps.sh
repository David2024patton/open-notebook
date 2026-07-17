#!/usr/bin/env bash
# Idempotent VPS deploy for Open Notebook.
#
# Pulls latest from the current branch, ensures required secrets are present in
# .env, (re)builds the app image, and brings the stack up. Safe to re-run.
#
# Usage:
#   scripts/deploy-vps.sh            # pull + build + up
#   scripts/deploy-vps.sh --no-pull  # skip git pull (use current working tree)
#
# Requires: docker, docker compose, git. No secrets are stored in this script;
# everything is read from the .env file in the repo root.
set -euo pipefail

# Locate repo root (this script lives in scripts/).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

log() { printf '\033[1;34m[deploy]\033[0m %s\n' "$*"; }
err() { printf '\033[1;31m[deploy:ERROR]\033[0m %s\n' "$*" >&2; }

# Pre-flight: docker + git
command -v docker >/dev/null 2>&1 || { err "docker not found"; exit 1; }
docker compose version >/dev/null 2>&1 || { err "docker compose plugin not found"; exit 1; }
command -v git >/dev/null 2>&1 || { err "git not found"; exit 1; }

DO_PULL=1
if [[ "${1:-}" == "--no-pull" ]]; then DO_PULL=0; fi

# 1. Pull latest (unless suppressed)
if [[ "${DO_PULL}" -eq 1 ]]; then
  log "git pull (current branch)"
  git pull --ff-only
fi

# 2. Ensure .env exists with required secrets. If missing, seed from the
#    example and refuse to continue until the user fills in the blanks.
if [[ ! -f .env ]]; then
  log ".env not found — copying .env.example"
  cp -n .env.example .env
  err ".env was just created from the example. Edit it and fill in the REQUIRED"
  err "secrets (OPEN_NOTEBOOK_ENCRYPTION_KEY, JWT_SECRET_KEY), then re-run."
  exit 1
fi

# 3. Validate required secrets are non-empty in .env. Compose also enforces
#    this via the \${VAR:?...} syntax, but checking here gives a clearer message.
missing=()
check_var() {
  local name="$1"
  # Only check lines that look like assignments (ignore commented/out lines).
  local val
  val="$(grep -E "^${name}=" .env 2>/dev/null | tail -n1 | cut -d= -f2- | tr -d '[:space:]')"
  if [[ -z "${val}" ]]; then
    missing+=("${name}")
  fi
}
check_var OPEN_NOTEBOOK_ENCRYPTION_KEY
check_var JWT_SECRET_KEY
if (( ${#missing[@]} )); then
  err "Required secrets missing or empty in .env:"
  for m in "${missing[@]}"; do err "  - ${m}"; done
  err "Fill them in, then re-run this script."
  exit 1
fi

# 4. Pull the DB image (always up to date) and build the app image.
log "docker compose pull (surrealdb)"
docker compose pull surrealdb

log "docker compose build --no-cache open_notebook"
docker compose build --no-cache open_notebook

# 5. Bring it up (recreate to pick up the fresh image). The healthcheck +
#    depends_on:condition:service_healthy ordering means the API will wait for
#    the DB to accept connections before starting.
log "docker compose up -d"
docker compose up -d

# 6. Show status + tail logs so the user can confirm it came up cleanly.
log "status:"
docker compose ps

log "recent logs (open_notebook):"
docker compose logs --tail=40 open_notebook || true

log "done. UI: http://localhost:8502  (or your domain via the Phase 2 proxy)"