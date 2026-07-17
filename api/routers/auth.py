"""
Authentication router for Open Notebook API.
Provides endpoints for user registration, login, and profile management.
Supports both single-password and multi-user modes with role-based access control.

Roles: superuser > admin > user
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from loguru import logger
from pydantic import BaseModel, EmailStr, Field, field_validator

from api.auth_multiuser import (
    AUTH_MODE,
    create_access_token,
    decode_access_token,
    hash_password,
    verify_password,
)
from open_notebook.domain.referral_code import ReferralCode
from open_notebook.domain.signup_request import SignupRequest
from open_notebook.domain.user import ROLES, User
from open_notebook.utils.encryption import get_secret_from_env

router = APIRouter(prefix="/auth", tags=["auth"])
security = HTTPBearer(auto_error=False)


# Request/Response models
class RegisterRequest(BaseModel):
    password: str = Field(..., min_length=6)
    email: EmailStr
    display_name: Optional[str] = None
    referral_code: Optional[str] = None


class LoginRequest(BaseModel):
    email: str
    password: str

    @field_validator('email')
    @classmethod
    def validate_email_format(cls, v: str) -> str:
        v = v.strip().lower()
        if '@' not in v:
            raise ValueError('Invalid email address')
        return v


class UserResponse(BaseModel):
    id: str
    username: str
    email: Optional[str] = None
    display_name: Optional[str] = None
    role: str
    is_active: bool
    requires_approval: bool
    referred_by: Optional[str] = None
    avatar_url: Optional[str] = None
    avatar_color: Optional[str] = None
    created: Optional[str] = None
    updated: Optional[str] = None


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


class Login2FARequiredResponse(BaseModel):
    requires_2fa: bool = True
    temp_token: str


class UpdateProfileRequest(BaseModel):
    email: Optional[EmailStr] = None
    display_name: Optional[str] = None


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(..., min_length=6)


class GenerateReferralCodeRequest(BaseModel):
    granted_role: str = Field(..., description="Role to grant when code is used")


class AdminCreateUserRequest(BaseModel):
    email: EmailStr
    username: str = Field(..., min_length=3, max_length=50)
    password: str = Field(..., min_length=6)
    display_name: Optional[str] = None
    role: str = Field(default="user")


class ReviewSignupRequest(BaseModel):
    action: str = Field(..., description="'approve' or 'reject'")
    reason: Optional[str] = None


class UpdateAvatarRequest(BaseModel):
    avatar_url: Optional[str] = None
    avatar_color: Optional[str] = None


class Verify2FARequest(BaseModel):
    code: str = Field(..., min_length=6, max_length=6)


class Login2FARequest(BaseModel):
    temp_token: str
    code: str = Field(..., min_length=6, max_length=6)


class NotificationResponse(BaseModel):
    id: str
    for_user: str
    from_user: Optional[str] = None
    title: str
    message: str
    notification_type: str
    is_read: bool
    link: Optional[str] = None
    created: Optional[str] = None


# Dependencies
async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> Optional[User]:
    """Get current authenticated user from JWT token."""
    if AUTH_MODE != "multi-user":
        return None
    
    if not credentials:
        raise HTTPException(
            status_code=401,
            detail="Missing authorization",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    try:
        payload = decode_access_token(credentials.credentials)
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token")
        
        user = await User.get(user_id)
        if not user or not user.is_active:
            raise HTTPException(status_code=401, detail="User not found or inactive")
        
        return user
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting current user: {e}")
        raise HTTPException(status_code=401, detail="Invalid token")


def require_role(required_role: str):
    """Dependency factory that requires a specific role or higher."""
    async def dependency(current_user: User = Depends(get_current_user)) -> User:
        if AUTH_MODE != "multi-user":
            raise HTTPException(status_code=400, detail="Multi-user mode not enabled")
        
        if not current_user:
            raise HTTPException(status_code=401, detail="Authentication required")
        
        if not current_user.has_permission(required_role):
            raise HTTPException(
                status_code=403,
                detail=f"Role '{required_role}' or higher required"
            )
        
        return current_user
    return dependency


async def require_auth(
    current_user: Optional[User] = Depends(get_current_user),
) -> Optional[User]:
    """Dependency that requires authentication in multi-user mode."""
    if AUTH_MODE == "multi-user" and not current_user:
        raise HTTPException(status_code=401, detail="Authentication required")
    return current_user


async def _assign_legacy_content(user_id: str) -> int:
    """
    Assign legacy notebooks (and their related sources/notes) that have no
    `owner` field set to the given user. Used during first-user bootstrap
    when transitioning from single-password mode to multi-user mode.

    Returns the number of notebook records updated.
    """
    from open_notebook.database.repository import ensure_record_id, repo_query

    try:
        unowned = await repo_query(
            "SELECT id FROM notebook WHERE owner IS NONE OR owner IS NULL"
        )
        if not unowned:
            return 0
        owner_ref = ensure_record_id(user_id)
        for row in unowned:
            nb_id = row.get("id")
            if nb_id:
                await repo_query(
                    "UPDATE $id SET owner = $owner",
                    {"id": ensure_record_id(str(nb_id)), "owner": owner_ref},
                )
        return len(unowned)
    except Exception as e:
        logger.warning(f"Failed to assign legacy content to {user_id}: {e}")
        return 0


# Auth status
@router.get("/status")
async def get_auth_status():
    """
    Check if authentication is enabled.
    Returns whether multi-user mode or single-password mode is active.
    """
    if AUTH_MODE == "multi-user":
        # Check if 2FA is enforced
        from open_notebook.domain.content_settings import ContentSettings
        try:
            settings: ContentSettings = await ContentSettings.get_instance()  # type: ignore[assignment]
            enforce_2fa = settings.enforce_2fa == "yes"
        except Exception:
            enforce_2fa = False
        
        return {
            "auth_mode": "multi-user",
            "auth_enabled": True,
            "enforce_2fa": enforce_2fa,
            "message": "Multi-user authentication is enabled",
        }
    
    auth_enabled = bool(get_secret_from_env("OPEN_NOTEBOOK_PASSWORD"))
    return {
        "auth_mode": "single-password",
        "auth_enabled": auth_enabled,
        "message": "Authentication is required" if auth_enabled else "Authentication is disabled",
    }


@router.get("/2fa/enforced")
async def check_2fa_enforced(current_user: User = Depends(require_auth)):
    """Check if 2FA is enforced and if the current user has it enabled."""
    if AUTH_MODE != "multi-user":
        return {"enforced": False, "enabled": False}
    
    from open_notebook.domain.content_settings import ContentSettings
    from open_notebook.domain.totp import UserTOTP
    
    try:
        settings: ContentSettings = await ContentSettings.get_instance()  # type: ignore[assignment]
        enforce_2fa = settings.enforce_2fa == "yes"
    except Exception:
        enforce_2fa = False
    
    user_totp = await UserTOTP.get_by_user_id(current_user.id or "")
    totp_enabled = user_totp.totp_enabled if user_totp else False
    
    return {
        "enforced": enforce_2fa,
        "enabled": totp_enabled,
    }


# Registration
@router.post("/register")
async def register(request: RegisterRequest):
    """
    Register a new user account (multi-user mode only).
    
    If a valid referral code is provided, the user is auto-approved.
    Otherwise, the signup request requires admin/superuser approval.
    """
    if AUTH_MODE != "multi-user":
        raise HTTPException(
            status_code=400,
            detail="Multi-user mode not enabled. Set OPEN_NOTEBOOK_AUTH_MODE=multi-user"
        )
    
    # Use email as username (lowercased, trimmed)
    username = request.email.strip().lower()
    
    # Check if username (email) already exists
    if await User.username_exists(username):
        raise HTTPException(status_code=400, detail="An account with this email already exists")
    
    # Check if email already exists
    if await User.email_exists(username):
        raise HTTPException(status_code=400, detail="An account with this email already exists")
    
    # Check if there's already a pending request for this username
    existing_request = await SignupRequest.get_by_username(username)
    if existing_request and existing_request.status == "pending":
        raise HTTPException(status_code=400, detail="A signup request for this email is already pending")
    
    # Validate referral code if provided
    referral_role = None
    if request.referral_code:
        referral = await ReferralCode.get_by_code(request.referral_code)
        if not referral:
            raise HTTPException(status_code=400, detail="Invalid referral code")
        if referral.is_used:
            raise HTTPException(status_code=400, detail="Referral code has already been used")
        referral_role = referral.granted_role

    # First-user bootstrap: if no users exist yet, this registration becomes
    # the superuser (auto-approved, no referral needed). This eliminates the
    # need for a separate create_superuser script when starting fresh.
    user_count = await User.count_all()
    is_first_user = user_count == 0
    if is_first_user:
        assigned_role = "superuser"
        needs_approval = False
        logger.info("First user registration: auto-promoting to superuser")
    else:
        # Determine if approval is needed
        needs_approval = referral_role is None
        assigned_role = referral_role if referral_role else "user"

    if needs_approval:
        # Create pending signup request
        signup_request = SignupRequest(
            username=username,
            email=username,
            password_hash=hash_password(request.password),
            display_name=request.display_name or username.split('@')[0],
            referral_code=request.referral_code,
            status="pending",
        )
        await signup_request.save()
        
        # Notify admins/superusers of pending signup request
        from open_notebook.domain.notification import notify_admins_of_signup
        await notify_admins_of_signup(
            new_user_name=username,
            new_user_role="user (pending approval)",
            referrer_name=None,
        )
        
        logger.info(f"Signup request created: {username} (pending approval)")
        
        return {
            "message": "Signup request submitted. Waiting for admin approval. You will receive an email once your account is reviewed.",
            "status": "pending",
            "requires_approval": True,
        }
    else:
        # Auto-approve with referral code, or first-user bootstrap
        user = User(
            username=username,
            email=username,
            password_hash=hash_password(request.password),
            display_name=request.display_name or username.split('@')[0],
            role=assigned_role,
            is_active=True,
            referred_by=request.referral_code,
        )
        await user.save()

        # First-user bootstrap: claim unowned legacy notebooks/sources for
        # the new superuser so they don't become orphaned when transitioning
        # from single-password mode to multi-user mode.
        if is_first_user:
            assigned = await _assign_legacy_content(user.id or "")
            if assigned:
                logger.info(f"Assigned {assigned} legacy records to first superuser {username}")

        # Mark referral code as used (if a referral was provided)
        if request.referral_code and referral:
            await referral.use_code(user.id or "")

        # Notify admins/superusers of new signup
        from open_notebook.domain.notification import notify_admins_of_signup
        await notify_admins_of_signup(
            new_user_name=username,
            new_user_role=assigned_role,
            referrer_name=None,
        )

        logger.info(f"User registered: {username} (role: {assigned_role})")

        return {
            "message": "Registration successful",
            "status": "approved",
            "requires_approval": False,
        }


# Login
@router.post("/login")
async def login(request: LoginRequest):
    """Login with email and password (multi-user mode)."""
    if AUTH_MODE != "multi-user":
        raise HTTPException(
            status_code=400,
            detail="Multi-user mode not enabled. Use password-based authentication."
        )
    
    # Find user by email (which is also the username)
    user = await User.get_by_email(request.email)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    
    # Check if user is active
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account is disabled")
    
    # Verify password
    if not verify_password(request.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    
    # Check if 2FA is enabled
    from open_notebook.domain.totp import UserTOTP
    user_totp = await UserTOTP.get_by_user_id(user.id or "")
    if user_totp and user_totp.totp_enabled:
        # Return a temporary token for 2FA verification
        temp_token = create_access_token(
            user_id=user.id or "",
            username=user.username,
            role=user.role,
        )
        return {
            "requires_2fa": True,
            "temp_token": temp_token,
        }
    
    # Create JWT token
    access_token = create_access_token(
        user_id=user.id or "",
        username=user.username,
        role=user.role,
    )
    
    logger.info(f"User logged in: {user.username}")
    
    return TokenResponse(
        access_token=access_token,
        user=UserResponse(
            id=user.id or "",
            username=user.username,
            email=user.email,
            display_name=user.display_name,
            role=user.role,
            is_active=user.is_active,
            requires_approval=user.requires_approval,
            referred_by=user.referred_by,
            avatar_url=user.avatar_url,
            avatar_color=user.avatar_color,
            created=str(user.created) if user.created else None,
            updated=str(user.updated) if user.updated else None,
        ),
    )


@router.post("/login/2fa")
async def login_2fa(
    request: Login2FARequest,
):
    """Complete login with 2FA code after initial email/password login."""
    if AUTH_MODE != "multi-user":
        raise HTTPException(
            status_code=400,
            detail="Multi-user mode not enabled"
        )
    
    import pyotp
    
    # Decode the temp token to get user info
    try:
        payload = decode_access_token(request.temp_token)
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token")
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    
    # Get the user
    user = await User.get(user_id)
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account is disabled")
    
    from open_notebook.domain.totp import UserTOTP
    user_totp = await UserTOTP.get_by_user_id(user.id or "")
    if not user_totp or not user_totp.totp_enabled:
        raise HTTPException(status_code=400, detail="2FA is not enabled for this account")
    
    # Verify the TOTP code
    totp = pyotp.TOTP(user_totp.totp_secret)
    if not totp.verify(request.code, valid_window=1):
        raise HTTPException(status_code=401, detail="Invalid 2FA code")
    
    # Create the final JWT token
    access_token = create_access_token(
        user_id=user.id or "",
        username=user.username,
        role=user.role,
    )
    
    logger.info(f"User logged in with 2FA: {user.username}")
    
    return TokenResponse(
        access_token=access_token,
        user=UserResponse(
            id=user.id or "",
            username=user.username,
            email=user.email,
            display_name=user.display_name,
            role=user.role,
            is_active=user.is_active,
            requires_approval=user.requires_approval,
            referred_by=user.referred_by,
            avatar_url=user.avatar_url,
            avatar_color=user.avatar_color,
            created=str(user.created) if user.created else None,
            updated=str(user.updated) if user.updated else None,
        ),
    )


# Profile
@router.get("/me", response_model=UserResponse)
async def get_profile(current_user: User = Depends(require_auth)):
    """Get current user's profile."""
    if AUTH_MODE != "multi-user":
        raise HTTPException(status_code=400, detail="Multi-user mode not enabled")
    
    return UserResponse(
        id=current_user.id or "",
        username=current_user.username,
        email=current_user.email,
        display_name=current_user.display_name,
        role=current_user.role,
        is_active=current_user.is_active,
        requires_approval=current_user.requires_approval,
        referred_by=current_user.referred_by,
        avatar_url=current_user.avatar_url,
        avatar_color=current_user.avatar_color,
        created=str(current_user.created) if current_user.created else None,
        updated=str(current_user.updated) if current_user.updated else None,
    )


@router.put("/me", response_model=UserResponse)
async def update_profile(
    request: UpdateProfileRequest,
    current_user: User = Depends(require_auth),
):
    """Update current user's profile."""
    if AUTH_MODE != "multi-user":
        raise HTTPException(status_code=400, detail="Multi-user mode not enabled")
    
    # Check if email is being changed and already exists
    if request.email and request.email != current_user.email:
        if await User.email_exists(request.email):
            raise HTTPException(status_code=400, detail="Email already exists")
        current_user.email = request.email
    
    if request.display_name is not None:
        current_user.display_name = request.display_name
    
    await current_user.save()
    
    return UserResponse(
        id=current_user.id or "",
        username=current_user.username,
        email=current_user.email,
        display_name=current_user.display_name,
        role=current_user.role,
        is_active=current_user.is_active,
        requires_approval=current_user.requires_approval,
        referred_by=current_user.referred_by,
        avatar_url=current_user.avatar_url,
        avatar_color=current_user.avatar_color,
        created=str(current_user.created) if current_user.created else None,
        updated=str(current_user.updated) if current_user.updated else None,
    )


@router.post("/change-password")
async def change_password(
    request: ChangePasswordRequest,
    current_user: User = Depends(require_auth),
):
    """Change current user's password."""
    if AUTH_MODE != "multi-user":
        raise HTTPException(status_code=400, detail="Multi-user mode not enabled")
    
    # Verify current password
    if not verify_password(request.current_password, current_user.password_hash):
        raise HTTPException(status_code=401, detail="Current password is incorrect")
    
    # Update password
    current_user.password_hash = hash_password(request.new_password)
    await current_user.save()
    
    logger.info(f"Password changed for user: {current_user.username}")
    
    return {"message": "Password changed successfully"}


# Two-Factor Authentication (TOTP)
@router.post("/2fa/setup")
async def setup_2fa(current_user: User = Depends(require_auth)):
    """
    Generate a new TOTP secret and QR code for the user.
    Returns the secret (for manual entry) and a QR code data URL.
    """
    if AUTH_MODE != "multi-user":
        raise HTTPException(status_code=400, detail="Multi-user mode not enabled")
    
    import base64
    import io

    import pyotp
    import qrcode
    
    # Generate a new TOTP secret
    secret = pyotp.random_base32()
    
    # Create the TOTP object
    totp = pyotp.TOTP(secret)
    
    # Generate the provisioning URI for QR code
    issuer_name = "Open Notebook"
    provisioning_uri = totp.provisioning_uri(
        name=current_user.email or current_user.username,
        issuer_name=issuer_name,
    )
    
    # Generate QR code
    qr = qrcode.QRCode(version=1, box_size=10, border=5)
    qr.add_data(provisioning_uri)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    
    # Convert to base64 data URL
    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    buffer.seek(0)
    qr_code_data_url = f"data:image/png;base64,{base64.b64encode(buffer.getvalue()).decode()}"
    
    # Store the secret in a separate table (not enabled yet)
    from open_notebook.domain.totp import UserTOTP
    
    # Delete any existing TOTP config for this user
    existing = await UserTOTP.get_by_user_id(current_user.id or "")
    if existing:
        await existing.delete()
    
    # Create new TOTP config
    user_totp = UserTOTP(
        user_id=current_user.id or "",
        totp_secret=secret,
        totp_enabled=False,
    )
    await user_totp.save()
    
    logger.info(f"2FA setup initiated for user: {current_user.username}")
    
    return {
        "secret": secret,
        "qr_code": qr_code_data_url,
        "provisioning_uri": provisioning_uri,
    }


@router.post("/2fa/verify")
async def verify_2fa_setup(
    request: Verify2FARequest,
    current_user: User = Depends(require_auth),
):
    """
    Verify a TOTP code to enable 2FA.
    The user must scan the QR code first, then enter a code to confirm.
    """
    if AUTH_MODE != "multi-user":
        raise HTTPException(status_code=400, detail="Multi-user mode not enabled")
    
    import pyotp
    
    from open_notebook.domain.totp import UserTOTP
    user_totp = await UserTOTP.get_by_user_id(current_user.id or "")
    
    if not user_totp or not user_totp.totp_secret:
        raise HTTPException(status_code=400, detail="2FA setup not initiated. Call /2fa/setup first.")
    
    totp = pyotp.TOTP(user_totp.totp_secret)
    
    # Verify the code (allow 1 time step tolerance for clock skew)
    if not totp.verify(request.code, valid_window=1):
        raise HTTPException(status_code=400, detail="Invalid verification code. Please try again.")
    
    # Enable 2FA
    user_totp.totp_enabled = True
    await user_totp.save()
    
    logger.info(f"2FA enabled for user: {current_user.username}")
    
    return {"message": "Two-factor authentication enabled successfully"}


class Disable2FARequest(BaseModel):
    current_password: str


@router.post("/2fa/disable")
async def disable_2fa(
    request: Disable2FARequest,
    current_user: User = Depends(require_auth),
):
    """
    Disable 2FA for the current user. Requires password confirmation.
    """
    if AUTH_MODE != "multi-user":
        raise HTTPException(status_code=400, detail="Multi-user mode not enabled")
    
    # Verify password before disabling 2FA
    if not verify_password(request.current_password, current_user.password_hash):
        raise HTTPException(status_code=401, detail="Incorrect password")
    
    from open_notebook.domain.totp import UserTOTP
    user_totp = await UserTOTP.get_by_user_id(current_user.id or "")
    if user_totp:
        await user_totp.delete()
    
    logger.info(f"2FA disabled for user: {current_user.username}")
    
    return {"message": "Two-factor authentication disabled successfully"}


@router.get("/2fa/status")
async def get_2fa_status(current_user: User = Depends(require_auth)):
    """Get the 2FA status for the current user."""
    if AUTH_MODE != "multi-user":
        raise HTTPException(status_code=400, detail="Multi-user mode not enabled")
    
    from open_notebook.domain.totp import UserTOTP
    user_totp = await UserTOTP.get_by_user_id(current_user.id or "")
    
    return {
        "enabled": user_totp.totp_enabled if user_totp else False,
        "configured": user_totp is not None,
    }


# Admin endpoints - User management
@router.get("/users", response_model=list[UserResponse])
async def list_users(current_user: User = Depends(require_role("admin"))):
    """List all users (admin and above)."""
    if AUTH_MODE != "multi-user":
        raise HTTPException(status_code=400, detail="Multi-user mode not enabled")
    
    users = await User.get_all()
    return [
        UserResponse(
            id=user.id or "",
            username=user.username,
            email=user.email,
            display_name=user.display_name,
            role=user.role,
            is_active=user.is_active,
            requires_approval=user.requires_approval,
            referred_by=user.referred_by,
            avatar_url=user.avatar_url,
            avatar_color=user.avatar_color,
            created=str(user.created) if user.created else None,
            updated=str(user.updated) if user.updated else None,
        )
        for user in users
    ]


@router.post("/users", response_model=UserResponse)
async def admin_create_user(
    request: AdminCreateUserRequest,
    current_user: User = Depends(require_role("admin")),
):
    """Admin creates a new user directly with a temporary password (admin+)."""
    if AUTH_MODE != "multi-user":
        raise HTTPException(status_code=400, detail="Multi-user mode not enabled")

    if await User.username_exists(request.username):
        raise HTTPException(status_code=400, detail="Username already exists")

    if await User.email_exists(request.email):
        raise HTTPException(status_code=400, detail="Email already exists")

    if request.role not in ROLES:
        raise HTTPException(status_code=400, detail=f"Role must be one of: {', '.join(ROLES)}")

    if not current_user.has_permission(request.role):
        raise HTTPException(status_code=403, detail="Cannot assign a role higher than your own")

    user = User(
        username=request.username,
        email=request.email,
        password_hash=hash_password(request.password),
        display_name=request.display_name or request.username,
        role=request.role,
        is_active=True,
        requires_approval=False,
    )
    await user.save()

    logger.info(f"Admin created user: {request.username} (role: {request.role}) by {current_user.username}")

    return UserResponse(
        id=user.id or "",
        username=user.username,
        email=user.email,
        display_name=user.display_name,
        role=user.role,
        is_active=user.is_active,
        requires_approval=user.requires_approval,
        referred_by=user.referred_by,
        avatar_url=user.avatar_url,
        avatar_color=user.avatar_color,
        created=str(user.created) if user.created else None,
        updated=str(user.updated) if user.updated else None,
    )


@router.delete("/users/{user_id}")
async def delete_user(
    user_id: str,
    current_user: User = Depends(require_role("admin")),
):
    """Delete a user (admin and above, cannot delete yourself or higher role)."""
    if AUTH_MODE != "multi-user":
        raise HTTPException(status_code=400, detail="Multi-user mode not enabled")

    # Don't allow deleting yourself
    if current_user.id == user_id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")

    user = await User.get(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Superuser protection: no one can delete a superuser (not even another superuser)
    if user.role == "superuser":
        raise HTTPException(
            status_code=403,
            detail="Superuser accounts cannot be deleted. Transfer superuser ownership first.",
        )

    # Don't allow deleting users with higher or equal role
    if not current_user.can_manage_user(user) or current_user.role == user.role:
        raise HTTPException(status_code=403, detail="Cannot delete users with equal or higher role")

    await user.delete()

    logger.info(f"User deleted: {user.username} by {current_user.username}")

    return {"message": "User deleted successfully"}


@router.put("/users/{user_id}/role")
async def update_user_role(
    user_id: str,
    role: str,
    current_user: User = Depends(require_role("superuser")),
):
    """Update a user's role (superuser only). Cannot demote a superuser."""
    if AUTH_MODE != "multi-user":
        raise HTTPException(status_code=400, detail="Multi-user mode not enabled")

    if role not in ROLES:
        raise HTTPException(status_code=400, detail=f"Role must be one of: {', '.join(ROLES)}")

    # Don't allow changing your own role
    if current_user.id == user_id:
        raise HTTPException(status_code=400, detail="Cannot change your own role")

    user = await User.get(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Superuser protection: cannot demote a superuser via this endpoint
    if user.role == "superuser" and role != "superuser":
        raise HTTPException(
            status_code=403,
            detail="Cannot demote a superuser. Use the superuser transfer endpoint instead.",
        )

    user.role = role
    await user.save()

    logger.info(f"User role updated: {user.username} -> {role} by {current_user.username}")

    return {"message": f"User role updated to {role}"}


@router.put("/users/{user_id}/toggle-active")
async def toggle_user_active(
    user_id: str,
    current_user: User = Depends(require_role("admin")),
):
    """Toggle user active status (admin and above). Cannot deactivate a superuser."""
    if AUTH_MODE != "multi-user":
        raise HTTPException(status_code=400, detail="Multi-user mode not enabled")

    # Don't allow deactivating yourself
    if current_user.id == user_id:
        raise HTTPException(status_code=400, detail="Cannot deactivate your own account")

    user = await User.get(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Superuser protection: cannot deactivate a superuser
    if user.role == "superuser":
        raise HTTPException(
            status_code=403,
            detail="Superuser accounts cannot be deactivated.",
        )

    user.is_active = not user.is_active
    await user.save()

    status_msg = "activated" if user.is_active else "deactivated"
    logger.info(f"User {status_msg}: {user.username} by {current_user.username}")
    
    return {"message": f"User {status_msg}"}


@router.post("/claim-legacy-content")
async def claim_legacy_content(current_user: User = Depends(require_role("admin"))):
    """
    Assign all notebooks without an owner to the current admin/superuser.
    Useful when migrating from single-password mode to multi-user mode after
    the first user has already been created (e.g. via create_superuser.py).
    """
    if AUTH_MODE != "multi-user":
        raise HTTPException(status_code=400, detail="Multi-user mode not enabled")

    assigned = await _assign_legacy_content(current_user.id or "")
    logger.info(f"Admin {current_user.username} claimed {assigned} legacy notebooks")
    return {"message": f"Claimed {assigned} unowned notebooks", "assigned": assigned}


# Signup request management
@router.get("/signup-requests")
async def list_signup_requests(
    current_user: User = Depends(require_role("admin")),
):
    """List all pending signup requests (admin and above)."""
    if AUTH_MODE != "multi-user":
        raise HTTPException(status_code=400, detail="Multi-user mode not enabled")
    
    requests = await SignupRequest.get_pending_requests()
    return [
        {
            "id": req.id or "",
            "username": req.username,
            "email": req.email,
            "display_name": req.display_name,
            "referral_code": req.referral_code,
            "status": req.status,
            "created": str(req.created) if req.created else None,
        }
        for req in requests
    ]


@router.post("/signup-requests/{request_id}/review")
async def review_signup_request(
    request_id: str,
    review: ReviewSignupRequest,
    current_user: User = Depends(require_role("admin")),
):
    """Approve or reject a signup request (admin and above)."""
    if AUTH_MODE != "multi-user":
        raise HTTPException(status_code=400, detail="Multi-user mode not enabled")
    
    from open_notebook.database.repository import ensure_record_id, repo_query
    
    # Get the signup request
    result = await repo_query(
        "SELECT * FROM signup_request WHERE id = $id",
        {"id": ensure_record_id(request_id)},
    )
    
    if not result:
        raise HTTPException(status_code=404, detail="Signup request not found")
    
    signup_request = SignupRequest(**result[0])
    
    if signup_request.status != "pending":
        raise HTTPException(status_code=400, detail="Request has already been reviewed")
    
    if review.action == "approve":
        # Create the user
        user = User(
            username=signup_request.username,
            email=signup_request.email,
            password_hash=signup_request.password_hash,
            display_name=signup_request.display_name,
            role="user",
            is_active=True,
        )
        await user.save()
        
        # Mark request as approved
        await signup_request.approve(current_user.id or "")
        
        # Notify admins/superusers of new signup
        from open_notebook.domain.notification import notify_admins_of_signup
        await notify_admins_of_signup(
            new_user_name=signup_request.username,
            new_user_role="user",
            referrer_name=signup_request.referral_code,
        )
        
        logger.info(f"Signup request approved: {signup_request.username} by {current_user.username}")
        
        return {"message": f"User {signup_request.username} approved and created"}
    
    elif review.action == "reject":
        await signup_request.reject(current_user.id or "", review.reason)
        
        logger.info(f"Signup request rejected: {signup_request.username} by {current_user.username}")
        
        return {"message": f"Signup request for {signup_request.username} rejected"}
    
    else:
        raise HTTPException(status_code=400, detail="Action must be 'approve' or 'reject'")


# Referral code management
@router.post("/referral-codes")
async def generate_referral_code(
    request: GenerateReferralCodeRequest,
    current_user: User = Depends(require_role("superuser")),
):
    """Generate a new referral code (superuser only)."""
    if AUTH_MODE != "multi-user":
        raise HTTPException(status_code=400, detail="Multi-user mode not enabled")
    
    if request.granted_role not in ROLES:
        raise HTTPException(status_code=400, detail=f"Invalid role: {request.granted_role}")
    
    referral = await ReferralCode.generate_code(
        created_by=current_user.id or "",
        granted_role=request.granted_role,
    )
    
    return {
        "id": referral.id or "",
        "code": referral.code,
        "granted_role": referral.granted_role,
        "created": str(referral.created) if referral.created else None,
    }


@router.get("/referral-codes")
async def list_referral_codes(current_user: User = Depends(require_role("superuser"))):
    """List all referral codes created by the current user (superuser only)."""
    if AUTH_MODE != "multi-user":
        raise HTTPException(status_code=400, detail="Multi-user mode not enabled")
    
    codes = await ReferralCode.get_by_creator(current_user.id or "")
    return [
        {
            "id": code.id or "",
            "code": code.code,
            "granted_role": code.granted_role,
            "is_used": code.is_used,
            "used_by": code.used_by,
            "used_at": str(code.used_at) if code.used_at else None,
            "created": str(code.created) if code.created else None,
        }
        for code in codes
    ]


@router.delete("/referral-codes/{code_id}")
async def delete_referral_code(
    code_id: str,
    current_user: User = Depends(require_role("superuser")),
):
    """Delete an unused referral code (superuser only)."""
    if AUTH_MODE != "multi-user":
        raise HTTPException(status_code=400, detail="Multi-user mode not enabled")
    
    from open_notebook.database.repository import ensure_record_id, repo_query
    
    result = await repo_query(
        "SELECT * FROM referral_code WHERE id = $id",
        {"id": ensure_record_id(code_id)},
    )
    
    if not result:
        raise HTTPException(status_code=404, detail="Referral code not found")
    
    code = ReferralCode(**result[0])
    
    if code.is_used:
        raise HTTPException(status_code=400, detail="Cannot delete a used referral code")
    
    await code.delete()
    
    logger.info(f"Referral code deleted: {code.code} by {current_user.username}")
    
    return {"message": "Referral code deleted"}


# Avatar update
@router.put("/me/avatar", response_model=UserResponse)
async def update_avatar(
    request: UpdateAvatarRequest,
    current_user: User = Depends(require_auth),
):
    """Update current user's avatar (URL or color)."""
    if AUTH_MODE != "multi-user":
        raise HTTPException(status_code=400, detail="Multi-user mode not enabled")

    if request.avatar_url is not None:
        current_user.avatar_url = request.avatar_url
    if request.avatar_color is not None:
        current_user.avatar_color = request.avatar_color

    await current_user.save()

    return UserResponse(
        id=current_user.id or "",
        username=current_user.username,
        email=current_user.email,
        display_name=current_user.display_name,
        role=current_user.role,
        is_active=current_user.is_active,
        requires_approval=current_user.requires_approval,
        referred_by=current_user.referred_by,
        avatar_url=current_user.avatar_url,
        avatar_color=current_user.avatar_color,
        created=str(current_user.created) if current_user.created else None,
        updated=str(current_user.updated) if current_user.updated else None,
    )


# Notification endpoints
@router.get("/notifications")
async def list_notifications(
    current_user: User = Depends(require_auth),
    unread_only: bool = False,
):
    """Get notifications for the current user."""
    if AUTH_MODE != "multi-user":
        raise HTTPException(status_code=400, detail="Multi-user mode not enabled")

    from open_notebook.domain.notification import get_user_notifications

    notifications = await get_user_notifications(
        current_user.id or "", unread_only=unread_only
    )
    return notifications


@router.get("/notifications/unread-count")
async def get_unread_count(current_user: User = Depends(require_auth)):
    """Get count of unread notifications for the current user."""
    if AUTH_MODE != "multi-user":
        raise HTTPException(status_code=400, detail="Multi-user mode not enabled")

    from open_notebook.domain.notification import get_unread_count

    count = await get_unread_count(current_user.id or "")
    return {"count": count}


@router.post("/notifications/{notification_id}/read")
async def mark_notification_read(
    notification_id: str,
    current_user: User = Depends(require_auth),
):
    """Mark a notification as read."""
    if AUTH_MODE != "multi-user":
        raise HTTPException(status_code=400, detail="Multi-user mode not enabled")

    from open_notebook.domain.notification import mark_as_read

    await mark_as_read(notification_id)
    return {"message": "Notification marked as read"}


@router.post("/notifications/read-all")
async def mark_all_notifications_read(
    current_user: User = Depends(require_auth),
):
    """Mark all notifications as read for the current user."""
    if AUTH_MODE != "multi-user":
        raise HTTPException(status_code=400, detail="Multi-user mode not enabled")

    from open_notebook.domain.notification import mark_all_as_read

    await mark_all_as_read(current_user.id or "")
    return {"message": "All notifications marked as read"}


@router.delete("/notifications/{notification_id}")
async def delete_notification(
    notification_id: str,
    current_user: User = Depends(require_auth),
):
    """Delete a notification."""
    if AUTH_MODE != "multi-user":
        raise HTTPException(status_code=400, detail="Multi-user mode not enabled")

    from open_notebook.domain.notification import delete_notification

    await delete_notification(notification_id)
    return {"message": "Notification deleted"}


# =============================================================================
# Superuser Transfer (requires 2FA verification)
# =============================================================================

class TransferSuperuserRequest(BaseModel):
    target_user_id: str = Field(..., description="The user to promote to superuser")
    totp_code: str = Field(..., min_length=6, max_length=6, description="2FA code from current superuser")
    password: str = Field(..., description="Current superuser's password for re-verification")


@router.post("/transfer-superuser")
async def transfer_superuser(
    request: TransferSuperuserRequest,
    current_user: User = Depends(require_role("superuser")),
):
    """
    Transfer superuser ownership to another user.

    Security requirements:
    - Caller must be the current superuser
    - Caller must provide their password (re-verification)
    - Caller must provide a valid TOTP 2FA code
    - Target user must exist and be an admin (cannot transfer to a regular user)

    After transfer:
    - Target user becomes superuser
    - Current user becomes admin
    - Both users' sessions remain valid (JWTs are stateless)
    """
    if AUTH_MODE != "multi-user":
        raise HTTPException(status_code=400, detail="Multi-user mode not enabled")

    # 1. Verify password
    if not verify_password(request.password, current_user.password_hash):
        raise HTTPException(status_code=401, detail="Password verification failed")

    # 2. Verify 2FA — the current superuser MUST have 2FA enabled
    import pyotp

    from open_notebook.domain.totp import UserTOTP

    user_totp = await UserTOTP.get_by_user_id(current_user.id or "")
    if not user_totp or not user_totp.totp_enabled:
        raise HTTPException(
            status_code=400,
            detail="2FA must be enabled on your account to transfer superuser ownership. Enable it in Settings → Profile first.",
        )

    totp = pyotp.TOTP(user_totp.totp_secret)
    if not totp.verify(request.totp_code, valid_window=1):
        raise HTTPException(status_code=401, detail="Invalid 2FA code")

    # 3. Get target user
    target_user = await User.get(request.target_user_id)
    if not target_user:
        raise HTTPException(status_code=404, detail="Target user not found")

    if target_user.id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot transfer to yourself")

    if target_user.role != "admin":
        raise HTTPException(
            status_code=400,
            detail="Superuser can only be transferred to an admin. Promote the target user to admin first.",
        )

    if not target_user.is_active:
        raise HTTPException(status_code=400, detail="Target user is not active")

    # 4. Perform the transfer
    target_user.role = "superuser"
    await target_user.save()

    current_user.role = "admin"
    await current_user.save()

    logger.warning(
        f"SUPERUSER TRANSFER: {current_user.username} -> {target_user.username}"
    )

    # Notify both users
    from open_notebook.domain.notification import create_notification
    try:
        await create_notification(
            for_user=target_user.id or "",
            title="Superuser Ownership Transferred",
            message=f"You are now the superuser. Transferred by {current_user.username}.",
            notification_type="superuser_transfer",
        )
        await create_notification(
            for_user=current_user.id or "",
            title="Superuser Ownership Relinquished",
            message=f"You are now an admin. Superuser transferred to {target_user.username}.",
            notification_type="superuser_transfer",
        )
    except Exception:
        pass

    return {
        "message": f"Superuser transferred from {current_user.username} to {target_user.username}",
        "new_superuser": target_user.username,
        "your_new_role": "admin",
    }


# =============================================================================
# SSH Server Management
# =============================================================================

import os as _os
import secrets as _secrets


@router.get("/ssh/status")
async def get_ssh_status(current_user: User = Depends(require_role("admin"))):
    """
    Get SSH server status. Shows whether SSH is enabled, the port, the
    configured user, and the current token (masked). Admin+ only.
    """
    if AUTH_MODE != "multi-user":
        raise HTTPException(status_code=400, detail="Multi-user mode not enabled")

    ssh_enabled = _os.environ.get("SSH_USER", "") != ""
    ssh_port = _os.environ.get("SSH_PORT", "2222")
    ssh_user = _os.environ.get("SSH_USER", "notebook")

    # Read the token file (the password stored in the credential)
    token_file = "/app/data/.ssh_token"
    token_set = False
    token_preview = None
    if _os.path.exists(token_file):
        try:
            with open(token_file, "r") as f:
                stored = f.read().strip()
                if stored:
                    token_set = True
                    token_preview = stored[:4] + "••••••••" + stored[-4:] if len(stored) > 8 else "••••••••"
        except Exception:
            pass

    return {
        "enabled": ssh_enabled,
        "port": int(ssh_port) if ssh_port.isdigit() else 2222,
        "username": ssh_user,
        "token_set": token_set,
        "token_preview": token_preview,
        "host": "localhost",
    }


@router.post("/ssh/reset-token")
async def reset_ssh_token(current_user: User = Depends(require_role("admin"))):
    """
    Reset the SSH password/token to a new random value. The old token is
    immediately invalidated. The new token is returned ONCE — it cannot be
    retrieved later. Admin+ only.

    Security: The token is a cryptographically random 24-character string.
    It is stored hashed (bcrypt) in /app/data/.ssh_token and applied on next
    container restart (or immediately if the setup-ssh.sh script is re-run).
    """
    if AUTH_MODE != "multi-user":
        raise HTTPException(status_code=400, detail="Multi-user mode not enabled")

    # Generate a cryptographically secure random token
    new_token = _secrets.token_urlsafe(18)  # ~24 chars, URL-safe

    # Store the token (plain — it's a container-local file protected by filesystem perms)
    token_file = "/app/data/.ssh_token"
    token_hash_file = "/app/data/.ssh_token_hash"
    try:
        with open(token_file, "w") as f:
            f.write(new_token)
        _os.chmod(token_file, 0o600)

        # Also store a bcrypt hash for verification
        hashed = hash_password(new_token)
        with open(token_hash_file, "w") as f:
            f.write(hashed)
        _os.chmod(token_hash_file, 0o600)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to store token: {e}")

    # Apply the new password immediately by running setup-ssh.sh
    import asyncio
    try:
        proc = await asyncio.create_subprocess_exec(
            "/bin/bash", "/app/scripts/setup-ssh.sh",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env={**_os.environ, "SSH_PASSWORD": new_token},
        )
        await proc.wait()
    except Exception as e:
        logger.warning(f"Failed to re-run setup-ssh.sh: {e}")

    logger.info(f"SSH token reset by {current_user.username}")

    return {
        "message": "SSH token reset. The old token is no longer valid.",
        "new_token": new_token,
        "warning": "Save this token now — it will not be shown again.",
    }


@router.post("/ssh/toggle")
async def toggle_ssh(
    current_user: User = Depends(require_role("admin")),
):
    """
    Toggle SSH server on/off. When off, the sshd process is stopped and
    the port is closed. When re-enabled, setup-ssh.sh runs and sshd starts.
    Admin+ only.
    """
    if AUTH_MODE != "multi-user":
        raise HTTPException(status_code=400, detail="Multi-user mode not enabled")

    import asyncio

    # Check if sshd is currently running
    proc = await asyncio.create_subprocess_exec(
        "pgrep", "-x", "sshd",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, _ = await proc.communicate()
    is_running = len(stdout.strip()) > 0

    if is_running:
        # Stop sshd
        proc = await asyncio.create_subprocess_exec(
            "pkill", "-x", "sshd",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        await proc.wait()
        logger.info(f"SSH server stopped by {current_user.username}")
        return {"message": "SSH server stopped", "enabled": False}
    else:
        # Start sshd — re-run setup-ssh.sh first
        ssh_password = ""
        token_file = "/app/data/.ssh_token"
        if _os.path.exists(token_file):
            try:
                with open(token_file, "r") as f:
                    ssh_password = f.read().strip()
            except Exception:
                pass
        if not ssh_password:
            ssh_password = _os.environ.get("SSH_PASSWORD", "notebook")

        env = {**_os.environ, "SSH_PASSWORD": ssh_password}
        proc = await asyncio.create_subprocess_exec(
            "/bin/bash", "/app/scripts/setup-ssh.sh",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )
        await proc.wait()

        # Start sshd
        proc = await asyncio.create_subprocess_exec(
            "/usr/sbin/sshd",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        await proc.wait()
        logger.info(f"SSH server started by {current_user.username}")
        return {"message": "SSH server started", "enabled": True}
