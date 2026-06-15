# Agent Notes - Open Notebook Multi-User

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
- `frontend/src/components/layout/TopNavbar.tsx`: moved Open Notebook branding to top-left for both mobile and desktop
- Removed branding from desktop sidebar
- `frontend/src/components/layout/MobileNav.tsx`: added mobile bottom navigation with back/forward/home and a menu dropdown
- `frontend/src/components/layout/AppShell.tsx`: sidebar hidden on mobile, bottom nav visible on mobile, main content gets bottom padding on mobile

### Sources Table
- `frontend/src/app/(dashboard)/sources/page.tsx`: adjusted column widths and reduced padding to prevent "Embedded" and "Actions" headers from colliding

## Docker / Build Notes

- Rebuild command: `docker-compose down && docker-compose build --no-cache && docker-compose up -d`
- Frontend runs on port 8502
- API runs on port 5055 (internal only)
- Users should always access via `http://localhost:8502`
- After frontend changes, users MUST hard refresh or clear browser cache due to Next.js standalone output caching

## Key Files

| Component | Path |
|-----------|------|
| Login form | `frontend/src/components/auth/LoginForm.tsx` |
| Auth hook | `frontend/src/lib/hooks/use-auth.ts` |
| Auth store | `frontend/src/lib/stores/auth-store.ts` |
| Runtime config | `frontend/src/app/config/route.ts` |
| Config loader | `frontend/src/lib/config.ts` |
| Auth router | `api/routers/auth.py` |
| Base select | `frontend/src/components/ui/select.tsx` |
| App shell | `frontend/src/components/layout/AppShell.tsx` |
| App sidebar | `frontend/src/components/layout/AppSidebar.tsx` |
| Top navbar | `frontend/src/components/layout/TopNavbar.tsx` |
| Mobile nav | `frontend/src/components/layout/MobileNav.tsx` |

## General Principles

1. **Consistent API signatures**: public hooks/functions should have one signature, not mode-dependent ones.
2. **Validate data flow before validators**: if validation fails for data that looks correct, check if the right value is in the right field.
3. **Frontend proxies through Next.js**: keep browser requests on the same origin; use rewrites for backend API.
4. **Normalize API errors**: FastAPI `detail` can be string or array; always normalize before rendering.
5. **Test through the proxy**: test API calls through `localhost:8502`, not just direct `localhost:5055`.
