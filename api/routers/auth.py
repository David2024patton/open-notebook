"""
Authentication router for Open Notebook API.
Provides endpoints for user registration, login, and profile management.
Supports both single-password and multi-user modes with role-based access control.

Roles: superuser > admin > user
"""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from loguru import logger
from pydantic import BaseModel, EmailStr, Field, field_validator

from api.auth import (
    AUTH_MODE,
    create_access_token,
    decode_access_token,
    hash_password,
    verify_password,
)
from open_notebook.domain.referral_code import ReferralCode
from open_notebook.domain.signup_request import SignupRequest
from open_notebook.domain.user import ROLE_HIERARCHY, ROLES, User
from open_notebook.utils.encryption import get_secret_from_env

router = APIRouter(prefix="/auth", tags=["auth"])
security = HTTPBearer(auto_error=False)


# Request/Response models
class RegisterRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    password: str = Field(..., min_length=6)
    email: Optional[EmailStr] = None
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


# Auth status
@router.get("/status")
async def get_auth_status():
    """
    Check if authentication is enabled.
    Returns whether multi-user mode or single-password mode is active.
    """
    if AUTH_MODE == "multi-user":
        return {
            "auth_mode": "multi-user",
            "auth_enabled": True,
            "message": "Multi-user authentication is enabled",
        }
    
    auth_enabled = bool(get_secret_from_env("OPEN_NOTEBOOK_PASSWORD"))
    return {
        "auth_mode": "single-password",
        "auth_enabled": auth_enabled,
        "message": "Authentication is required" if auth_enabled else "Authentication is disabled",
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
    
    # Check if username already exists
    if await User.username_exists(request.username):
        raise HTTPException(status_code=400, detail="Username already exists")
    
    # Check if email already exists
    if request.email and await User.email_exists(request.email):
        raise HTTPException(status_code=400, detail="Email already exists")
    
    # Check if there's already a pending request for this username
    existing_request = await SignupRequest.get_by_username(request.username)
    if existing_request and existing_request.status == "pending":
        raise HTTPException(status_code=400, detail="A signup request for this username is already pending")
    
    # Validate referral code if provided
    referral_role = None
    if request.referral_code:
        referral = await ReferralCode.get_by_code(request.referral_code)
        if not referral:
            raise HTTPException(status_code=400, detail="Invalid referral code")
        if referral.is_used:
            raise HTTPException(status_code=400, detail="Referral code has already been used")
        referral_role = referral.granted_role
    
    # Determine if approval is needed
    needs_approval = referral_role is None
    
    if needs_approval:
        # Create pending signup request
        signup_request = SignupRequest(
            username=request.username,
            email=request.email,
            password_hash=hash_password(request.password),
            display_name=request.display_name,
            referral_code=request.referral_code,
            status="pending",
        )
        await signup_request.save()
        
        logger.info(f"Signup request created: {request.username} (pending approval)")
        
        return {
            "message": "Signup request submitted. Waiting for admin approval.",
            "status": "pending",
            "requires_approval": True,
        }
    else:
        # Auto-approve with referral code
        user = User(
            username=request.username,
            email=request.email,
            password_hash=hash_password(request.password),
            display_name=request.display_name,
            role=referral_role,
            is_active=True,
            referred_by=request.referral_code,
        )
        await user.save()
        
        # Mark referral code as used
        await referral.use_code(user.id or "")
        
        # Notify admins/superusers of new signup
        from open_notebook.domain.notification import notify_admins_of_signup
        await notify_admins_of_signup(
            new_user_name=request.username,
            new_user_role=referral_role,
            referrer_name=None,
        )
        
        logger.info(f"User registered via referral code: {request.username} (role: {referral_role})")
        
        return {
            "message": "Registration successful",
            "status": "approved",
            "requires_approval": False,
        }


# Login
@router.post("/login", response_model=TokenResponse)
async def login(request: LoginRequest):
    """Login with email and password (multi-user mode)."""
    if AUTH_MODE != "multi-user":
        raise HTTPException(
            status_code=400,
            detail="Multi-user mode not enabled. Use password-based authentication."
        )
    
    # Find user by email
    user = await User.get_by_email(request.email)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    
    # Check if user is active
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account is disabled")
    
    # Verify password
    if not verify_password(request.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    
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
    """Update a user's role (superuser only)."""
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
    
    user.role = role
    await user.save()
    
    logger.info(f"User role updated: {user.username} -> {role} by {current_user.username}")
    
    return {"message": f"User role updated to {role}"}


@router.put("/users/{user_id}/toggle-active")
async def toggle_user_active(
    user_id: str,
    current_user: User = Depends(require_role("admin")),
):
    """Toggle user active status (admin and above)."""
    if AUTH_MODE != "multi-user":
        raise HTTPException(status_code=400, detail="Multi-user mode not enabled")
    
    # Don't allow deactivating yourself
    if current_user.id == user_id:
        raise HTTPException(status_code=400, detail="Cannot deactivate your own account")
    
    user = await User.get(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    user.is_active = not user.is_active
    await user.save()
    
    status = "activated" if user.is_active else "deactivated"
    logger.info(f"User {status}: {user.username} by {current_user.username}")
    
    return {"message": f"User {status}"}


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
