=======
# Cortex — Agent Rules

Cortex is an open-source, privacy-focused alternative to Google's Notebook LM: an AI-powered research assistant with multi-provider AI support, fully self-hostable.

This file holds the project-wide rules every coding session needs. Component rules: [open_notebook/AGENTS.md](open_notebook/AGENTS.md) (backend — also covers `api/`, `commands/`, `prompts/`) and [frontend/AGENTS.md](frontend/AGENTS.md). Knowledge lives in the docs (see [Where to look](#where-to-look)) — read it on demand instead of guessing.

## Stack, ports, startup order

Three tiers: Next.js frontend (3000) → FastAPI (5055) → SurrealDB (8000).

Start in this order — each tier depends on the one below:

1. `make database` — SurrealDB (API fails without it)
2. `make api` — FastAPI; **schema migrations run automatically on startup** (check logs)
3. `make worker-start` — surreal-commands worker. **Required**: podcasts, embeddings and source processing are async jobs that silently queue forever without it
4. `make frontend` — UI (depends on the API for all data)

Or all at once: `make start-all` (status: `make status`, stop: `make stop-all`).

## Commands

- Tests: `uv run pytest tests/`
- Python lint/typecheck: `ruff check . --fix` · `uv run python -m mypy .`
- Frontend (inside `frontend/`): `npm run lint` · `npm run test` · `npm run build`
- Docker release: `make docker-release` (see `.github/RELEASE_PROCESS.md`)

## Hard rules

- **Async-first**: every DB query, graph invocation and AI call is `await`-ed. No sync DB access.
- **Never commit secrets.** Credentials are encrypted at rest and require `OPEN_NOTEBOOK_ENCRYPTION_KEY` to be set.
- CORS is wide-open and auth is a simple password middleware — **dev defaults, not production hardening**. Don't build features that assume otherwise.
- Product direction questions (does this feature fit?) → [VISION.md](VISION.md). Past decisions ("why is it like this?") → [docs/7-DEVELOPMENT/decisions/](docs/7-DEVELOPMENT/decisions/). Structural decisions made while coding should produce a new decision record there.

## Where to look

| Need | Location |
|---|---|
| Architecture (3 tiers, workflows, data model) | [docs/7-DEVELOPMENT/architecture.md](docs/7-DEVELOPMENT/architecture.md) |
| Step-by-step recipes (add endpoint, migration, i18n…) | [docs/7-DEVELOPMENT/change-playbooks.md](docs/7-DEVELOPMENT/change-playbooks.md) |
| Dev environment setup | [docs/7-DEVELOPMENT/development-setup.md](docs/7-DEVELOPMENT/development-setup.md) |
| Code standards & testing | [docs/7-DEVELOPMENT/code-standards.md](docs/7-DEVELOPMENT/code-standards.md) · [testing.md](docs/7-DEVELOPMENT/testing.md) |
| Product identity & current posture | [VISION.md](VISION.md) |
| Decision log (ADRs/PDRs) | [docs/7-DEVELOPMENT/decisions/](docs/7-DEVELOPMENT/decisions/) |
| Contribution process (issue-first, PRs) | [docs/7-DEVELOPMENT/contributing.md](docs/7-DEVELOPMENT/contributing.md) |
| User/operator docs (install, configure, troubleshoot) | [docs/](docs/index.md) |

# Multi-User Extension Notes

# Agent Notes - Cortex Multi-User

This file documents critical fixes, patterns, and gotchas discovered during development so future agents (and humans) don't repeat the same mistakes.

## Critical Bug Fixes

### 1. Login Form Parameter Order (2026-06-13)

**Problem:** The login form in `frontend/src/components/auth/LoginForm.tsx` was calling the `login` hook with parameters in the wrong order: `login(password, email)` instead of `login(email, password)`. The `useAuth` hook exposed `handleMultiUserLogin(email, password)` which internally called the auth store's `login(password, email)`. The form passed them swapped, so the user's password was sent in the `email` field and vice versa.

**Symptoms:**
- "value is not a valid email address" errors
- "Invalid email address" errors
- Correct credentials never worked
- Pydantic 422 validation errors in API logs

**Fix:**
- `LoginForm.tsx`: call `login(email, password)` for multi-user mode and `login('', password)` for single-password mode
- `use-auth.ts`: made the exposed `login` function always use a consistent `(email, password)` signature
- `use-auth.ts`: fixed registration auto-login call from `login(password, email)` to `login(email || '', password)`

**Lesson:** When a hook/function has mode-dependent signatures, make the public API consistent. Always call auth/login functions with `(email, password)` order.

### 2. API URL Auto-Detection Caused CORS/Proxy Issues (2026-06-13)

**Problem:** The `/config` runtime endpoint auto-detected `http://localhost:5055` as the API URL. This caused the browser to make direct requests to the API backend instead of routing through the Next.js proxy at port 8502. This led to:
- 422 errors from malformed request bodies
- CORS confusion
- Cached config responses sticking to old API URLs

**Fix:**
- `frontend/src/app/config/route.ts`: always returns `{ apiUrl: '' }` so the frontend uses relative paths through the Next.js rewrite proxy
- Added `Cache-Control: no-store` headers to prevent browser caching
- `frontend/src/lib/config.ts`: added cache-busting query parameter (`?_=${Date.now()}`) to `/config` fetch

**Lesson:** The frontend should always use relative `/api/*` paths through the Next.js proxy. Never point the browser directly at port 5055.

### 3. Error Rendering Crash (React error #31)

**Problem:** When the API returned a 422 validation error, `errorData.detail` was an array of Pydantic error objects. The auth store set `error: errorData.detail` directly, and React crashed trying to render objects as children.

**Fix:** `frontend/src/lib/stores/auth-store.ts` now normalizes error responses:
```ts
let errorMessage = 'Login failed'
if (typeof errorData.detail === 'string') {
  errorMessage = errorData.detail
} else if (Array.isArray(errorData.detail)) {
  errorMessage = errorData.detail.map((e: any) => e.msg || JSON.stringify(e)).join(', ')
}
```

Applied to login, registration, profile update, and password change error handlers.

**Lesson:** Never assume `detail` is a string. FastAPI/Pydantic validation errors return arrays.

### 4. Email Validation Strictness

**Problem:** Pydantic's `EmailStr` rejected some valid email TLDs/formats during login because the email field was receiving the password due to the swapped parameter bug.

**Fix:** Relaxed `LoginRequest.email` from `EmailStr` to `str` with a simple `@` check. This is acceptable for login because the actual user lookup enforces exact matching against the registered email stored in the database.

**Lesson:** If a parameter was accidentally receiving wrong data, don't assume the validation is the root cause. Check the data flow first.

## UI Fixes

### Tailwind v4 Arbitrary Values in Production

**Problem:** Tailwind v4 arbitrary value classes like `text-[9px]` and `text-[10px]` were not being generated into the production CSS bundle. In development they appeared to work, but in the Docker/standalone build the browser fell back to default element styles (e.g. browser default `h3` sizing), making sidebar section headers and hints look huge.

**Fix:** Replaced arbitrary Tailwind text-size classes with inline `style={{ fontSize: '9px' }}` (and `10px`) for sizes below Tailwind's standard scale. Standard classes like `text-xs`/`text-sm` work fine.

**Affected:** `frontend/src/components/layout/AppSidebar.tsx`

**Lesson:** Don't rely on Tailwind v4 arbitrary values for critical sizing in production until verified in the built output. Prefer standard tokens or inline styles for non-standard values.

### Dropdown Truncation
- `frontend/src/components/ui/select.tsx`: constrained `SelectContent` width (`min-w-[12rem] max-w-[18rem]`)
- `SelectItem` wraps text in `truncate min-w-0 w-full` div so long model names and file names don't overflow
- `SelectTrigger` truncates selected value display

### Left Navigation
- `frontend/src/components/layout/AppSidebar.tsx`: reduced section header size and visual weight
- `frontend/src/components/layout/TopNavbar.tsx`: moved Cortex branding to top-left for both mobile and desktop
- Removed branding from desktop sidebar
- `frontend/src/components/layout/MobileNav.tsx`: added mobile bottom navigation with back/forward/home and a menu dropdown
- `frontend/src/components/layout/AppShell.tsx`: sidebar hidden on mobile, bottom nav visible on mobile, main content gets bottom padding on mobile

### Sources Table
- `frontend/src/app/(dashboard)/sources/page.tsx`: adjusted column widths and reduced padding to prevent "Embedded" and "Actions" headers from colliding

## Docker / Build Notes

- Rebuild command: `docker-compose down && docker-compose build --no-cache && docker-compose up -d`
- Frontend runs on port 8502
- API runs on port 5055 (internal only)
- SSH runs on port 2222 (optional, enabled by default)
- Users should always access via `http://localhost:8502`
- After frontend changes, users MUST hard refresh or clear browser cache due to Next.js standalone output caching

### SSH Access
The container runs `sshd` under supervisord on port 2222, so you can SSH in alongside the web GUI:
```bash
ssh notebook@localhost -p 2222
# default password: notebook
```
Configure via env vars in `docker-compose.yml`: `SSH_USER`, `SSH_PASSWORD`, `SSH_PORT`. For key-based auth, mount your pubkey at `/app/ssh/authorized_keys`:
```yaml
volumes:
  - ./authorized_keys:/app/ssh/authorized_keys:ro
```
The SSH user has read access to the venv and can run `uv run python`, `git`, etc. inside the container. Useful for MCP SSH integrations and terminal debugging.

## Multi-User Auth

### First-User Bootstrap
When `OPEN_NOTEBOOK_AUTH_MODE=multi-user` and no users exist yet, the first registration via `POST /api/auth/register` is auto-promoted to `superuser` and auto-approved (no referral code needed). Legacy notebooks with no `owner` field are also assigned to this first superuser at registration time. Admins can re-claim unowned notebooks later via `POST /api/auth/claim-legacy-content`.

### Rate Limiting
`api/rate_limit.py` provides `RateLimitMiddleware` — an in-memory sliding-window IP-based limiter registered in `api/main.py`. It protects `/api/auth/login`, `/api/auth/register`, `/api/auth/change-password`, `/api/auth/2fa`, and `/api/credentials/*`. Returns HTTP 429 with `Retry-After` when exceeded. Tuned for single-process deployments.

### Ollama Cloud Provider
The `ollama_cloud` provider is a distinct credential entry that maps to the same Esperanto `ollama` provider but with a remote base URL (and optional API key). Routing happens in:
- `open_notebook/ai/models.py`: `ollama_cloud`/`ollama-cloud` → `ollama` for Esperanto
- `open_notebook/ai/key_provider.py`: sets `OLLAMA_API_BASE` from the `ollama_cloud` credential's `base_url`
- `open_notebook/ai/model_discovery.py`: `discover_ollama_cloud_models()` reads the cloud base URL + key from the Credential record
- `api/credentials_service.py`: test + discover helpers for `ollama_cloud`
- Frontend `api-keys/page.tsx`: shown under "Cloud" category, supports optional API key + `num_ctx` override

## Key Files

| Component | Path |
|-----------|------|
| Login form | `frontend/src/components/auth/LoginForm.tsx` |
| Auth hook | `frontend/src/lib/hooks/use-auth.ts` |
| Auth store | `frontend/src/lib/stores/auth-store.ts` |
| Runtime config | `frontend/src/app/config/route.ts` |
| Config loader | `frontend/src/lib/config.ts` |
| Auth router | `api/routers/auth.py` |
| Rate limiter | `api/rate_limit.py` |
| Base select | `frontend/src/components/ui/select.tsx` |
| App shell | `frontend/src/components/layout/AppShell.tsx` |
| App sidebar | `frontend/src/components/layout/AppSidebar.tsx` |
| Top navbar | `frontend/src/components/layout/TopNavbar.tsx` |
| Mobile nav | `frontend/src/components/layout/MobileNav.tsx` |

## Model Discovery

### Ollama Auto-Discovery (2026-06-16)

**Problem:** Ollama models were not being discovered because:
1. The default URL was `localhost:11434` which doesn't work from inside Docker
2. The API response didn't include capability information

**Fix:**
- Set default URL to `http://host.docker.internal:11434` in `model_discovery.py`
- Added `OLLAMA_API_BASE` environment variable to `docker-compose.yml`
- Added `_extract_ollama_tags()` function to extract capabilities from Ollama API response
- Capabilities extracted from `capabilities` array: vision→image, tools→tool, thinking→thinking
- Family information extracted from `details.families`: moe detection
- Tags displayed as small badges in the model discovery dialog

**Key Files:**
- `open_notebook/ai/model_discovery.py`: Ollama discovery + tag extraction
- `api/routers/models.py`: `DiscoveredModelResponse` with tags field
- `frontend/src/lib/api/credentials.ts`: `DiscoveredModel` interface
- `frontend/src/app/(dashboard)/settings/api-keys/page.tsx`: Badge display

## General Principles

1. **Consistent API signatures**: public hooks/functions should have one signature, not mode-dependent ones.
2. **Validate data flow before validators**: if validation fails for data that looks correct, check if the right value is in the right field.
3. **Frontend proxies through Next.js**: keep browser requests on the same origin; use rewrites for backend API.
4. **Normalize API errors**: FastAPI `detail` can be string or array; always normalize before rendering.
5. **Test through the proxy**: test API calls through `localhost:8502`, not just direct `localhost:5055`.
6. **Docker network access**: Use `host.docker.internal` to reach host machine services from Docker containers.
