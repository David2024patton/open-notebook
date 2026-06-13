# Changelog - Multi-User Feature

All notable changes to the multi-user feature implementation are documented here.

---

## [Unreleased] - Multi-User Support

### Summary
This feature adds multi-user support to Open Notebook with JWT-based authentication, user registration, login, and admin management capabilities. The implementation is backward compatible - existing single-password mode continues to work unchanged.

### Added
- `open_notebook/domain/user.py` — New User domain model with username, email, password_hash, role, is_active fields
- `open_notebook/domain/referral_code.py` — Referral code system for auto-approving signups
- `open_notebook/domain/signup_request.py` — Signup request model for approval workflow
- Database migration `15.surrealql` — Creates user, referral_code, and signup_request tables
- Database migration `15_down.surrealql` — Rollback migration to remove all tables
- Updated `open_notebook/database/async_migrate.py` — Added migration 15 to migration list
- `api/routers/auth.py` — Complete user management API with register, login, profile, change-password, admin endpoints
- `frontend/src/app/(dashboard)/admin/page.tsx` — Admin UI for managing referral codes
- `create_superuser.py` — Script to create initial superuser account
- `.env` — Pre-configured for multi-user mode with JWT settings

### Changed
- `api/auth.py` — Rewritten to support both single-password and JWT-based multi-user auth modes
- `api/routers/auth.py` — Added register, login, profile, change-password, admin user management endpoints
- `api/main.py` — Updated to use new AuthMiddleware, added /api/auth/login and /api/auth/register to excluded paths
- `frontend/src/lib/stores/auth-store.ts` — Updated to support JWT tokens, user info, and multi-user login flow
- `frontend/src/components/auth/LoginForm.tsx` — Added username field, registration form, and mode switching
- `pyproject.toml` — Added pyjwt and bcrypt dependencies for JWT and password hashing
- `docker-compose.yml` — Added documentation for new multi-user environment variables

### Database Schema
```sql
DEFINE TABLE user SCHEMAFULL;
DEFINE FIELD username ON user TYPE string;
DEFINE FIELD email ON user TYPE option<string>;
DEFINE FIELD password_hash ON user TYPE string;
DEFINE FIELD display_name ON user TYPE option<string>;
DEFINE FIELD role ON user TYPE string VALUE $value OR 'user';
DEFINE FIELD is_active ON user TYPE bool VALUE $value OR true;
DEFINE FIELD requires_approval ON user TYPE bool VALUE $value OR false;
DEFINE FIELD referred_by ON user TYPE option<string>;
DEFINE FIELD created ON user TYPE option<datetime>;
DEFINE FIELD updated ON user TYPE option<datetime>;
DEFINE INDEX idx_user_username ON user FIELDS username UNIQUE;
DEFINE INDEX idx_user_email ON user FIELDS email UNIQUE;

DEFINE TABLE referral_code SCHEMAFULL;
DEFINE FIELD code ON referral_code TYPE string;
DEFINE FIELD created_by ON referral_code TYPE string;
DEFINE FIELD granted_role ON referral_code TYPE string;
DEFINE FIELD is_used ON referral_code TYPE bool VALUE $value OR false;
DEFINE FIELD used_by ON referral_code TYPE option<string>;
DEFINE FIELD used_at ON referral_code TYPE option<datetime>;
DEFINE FIELD created ON referral_code TYPE option<datetime>;
DEFINE FIELD updated ON referral_code TYPE option<datetime>;
DEFINE INDEX idx_referral_code ON referral_code FIELDS code UNIQUE;

DEFINE TABLE signup_request SCHEMAFULL;
DEFINE FIELD username ON signup_request TYPE string;
DEFINE FIELD email ON signup_request TYPE option<string>;
DEFINE FIELD password_hash ON signup_request TYPE string;
DEFINE FIELD display_name ON signup_request TYPE option<string>;
DEFINE FIELD referral_code ON signup_request TYPE option<string>;
DEFINE FIELD status ON signup_request TYPE string VALUE $value OR 'pending';
DEFINE FIELD reviewed_by ON signup_request TYPE option<string>;
DEFINE FIELD reviewed_at ON signup_request TYPE option<datetime>;
DEFINE FIELD rejection_reason ON signup_request TYPE option<string>;
DEFINE FIELD created ON signup_request TYPE option<datetime>;
DEFINE FIELD updated ON signup_request TYPE option<datetime>;
DEFINE INDEX idx_signup_status ON signup_request FIELDS status;
```

### Environment Variables Added
- `JWT_SECRET_KEY` — Secret key for JWT token signing (required for multi-user mode)
- `OPEN_NOTEBOOK_AUTH_MODE` — Set to "multi-user" to enable user accounts (default: "single-password")
- `JWT_EXPIRATION_HOURS` — JWT token expiration in hours (default: 24)

### Role Hierarchy
- **superuser** (level 3): Full system access, can manage all users, generate referral codes
- **admin** (level 2): Can manage users, approve signup requests
- **user** (level 1): Basic access, can manage own profile

### Usage Instructions

#### Single-Password Mode (Default - Backward Compatible)
No changes needed. Existing deployments continue to work unchanged.

#### Multi-User Mode
1. Set environment variables:
   ```bash
   OPEN_NOTEBOOK_AUTH_MODE=multi-user
   JWT_SECRET_KEY=your-secure-secret-key
   ```

2. Restart the application:
   ```bash
   docker-compose down
   docker-compose up -d
   ```

3. First user to register becomes superuser (feature pending - currently all users are regular users)

4. Admin can manage users via API:
   - `GET /api/auth/users` - List all users
   - `DELETE /api/auth/users/{user_id}` - Delete a user
   - `PUT /api/auth/users/{user_id}/role?role=admin` - Promote user to admin
   - `PUT /api/auth/users/{user_id}/toggle-active` - Activate/deactivate user

5. Superuser can generate referral codes:
   - `POST /api/auth/referral-codes` - Generate new code with role
   - `GET /api/auth/referral-codes` - List all codes
   - `DELETE /api/auth/referral-codes/{code_id}` - Delete unused code

6. Signup approval workflow:
   - Users without referral codes create pending signup requests
   - Admins/superusers can approve/reject via:
     - `GET /api/auth/signup-requests` - List pending requests
     - `POST /api/auth/signup-requests/{request_id}/review` - Approve/reject

### API Endpoints Added
- `POST /api/auth/register` - Register new user (with optional referral code)
- `POST /api/auth/login` - Login with username/password, returns JWT
- `GET /api/auth/me` - Get current user profile
- `PUT /api/auth/me` - Update current user profile
- `POST /api/auth/change-password` - Change password
- `GET /api/auth/users` - List all users (admin only)
- `DELETE /api/auth/users/{user_id}` - Delete user (admin only)
- `PUT /api/auth/users/{user_id}/role` - Update user role (superuser only)
- `PUT /api/auth/users/{user_id}/toggle-active` - Toggle user active status (admin only)
- `GET /api/auth/signup-requests` - List pending signup requests (admin only)
- `POST /api/auth/signup-requests/{request_id}/review` - Approve/reject signup (admin only)
- `POST /api/auth/referral-codes` - Generate referral code (superuser only)
- `GET /api/auth/referral-codes` - List referral codes (superuser only)
- `DELETE /api/auth/referral-codes/{code_id}` - Delete referral code (superuser only)

### Security Features
- Passwords hashed with bcrypt (work factor 12)
- JWT tokens with configurable expiration
- Role-based access control (superuser, admin, user)
- Referral codes for auto-approving signups
- Signup approval workflow for new users
- User accounts can be activated/deactivated
- Backward compatible with existing single-password deployments

### Notes
- Backward compatible: single-password mode still works when `OPEN_NOTEBOOK_AUTH_MODE` is not set
- Users table is isolated — existing notebooks/sources get assigned to first admin user during migration (feature pending)
- Passwords are hashed with bcrypt (work factor 12)
- JWT tokens expire after 24 hours by default
- Referral codes are single-use and can be generated by superusers
- Signup requests require admin/superuser approval unless a valid referral code is provided
