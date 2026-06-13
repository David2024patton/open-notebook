from datetime import datetime
from typing import ClassVar, Optional

from loguru import logger
from pydantic import Field, field_validator

from open_notebook.database.repository import repo_query
from open_notebook.domain.base import ObjectModel
from open_notebook.exceptions import DatabaseOperationError, InvalidInputError

# Role hierarchy: superuser > admin > user
ROLES = ("superuser", "admin", "user")
ROLE_HIERARCHY = {"superuser": 3, "admin": 2, "user": 1}


class User(ObjectModel):
    table_name: ClassVar[str] = "user"
    nullable_fields: ClassVar[set[str]] = {"email", "display_name", "role", "referred_by", "avatar_url", "avatar_color"}
    
    username: str
    email: Optional[str] = None
    password_hash: str
    display_name: Optional[str] = None
    role: str = Field(default="user")
    is_active: bool = Field(default=True)
    requires_approval: bool = Field(default=False)
    referred_by: Optional[str] = None
    avatar_url: Optional[str] = None
    avatar_color: Optional[str] = None

    @field_validator("username")
    @classmethod
    def username_must_not_be_empty(cls, v):
        if not v.strip():
            raise InvalidInputError("Username cannot be empty")
        return v.strip()

    @field_validator("role")
    @classmethod
    def role_must_be_valid(cls, v):
        if v not in ROLES:
            raise InvalidInputError(f"Role must be one of: {', '.join(ROLES)}")
        return v

    @classmethod
    async def get_by_username(cls, username: str) -> Optional["User"]:
        """Find a user by username."""
        try:
            result = await repo_query(
                "SELECT * FROM user WHERE username = $username",
                {"username": username},
            )
            if result:
                return cls(**result[0])
            return None
        except Exception as e:
            logger.error(f"Error fetching user by username: {str(e)}")
            raise DatabaseOperationError(e)

    @classmethod
    async def get_by_email(cls, email: str) -> Optional["User"]:
        """Find a user by email."""
        try:
            result = await repo_query(
                "SELECT * FROM user WHERE email = $email",
                {"email": email},
            )
            if result:
                return cls(**result[0])
            return None
        except Exception as e:
            logger.error(f"Error fetching user by email: {str(e)}")
            raise DatabaseOperationError(e)

    @classmethod
    async def username_exists(cls, username: str) -> bool:
        """Check if a username already exists."""
        user = await cls.get_by_username(username)
        return user is not None

    @classmethod
    async def email_exists(cls, email: str) -> bool:
        """Check if an email already exists."""
        user = await cls.get_by_email(email)
        return user is not None

    def has_permission(self, required_role: str) -> bool:
        """Check if user has the required role or higher."""
        user_level = ROLE_HIERARCHY.get(self.role, 0)
        required_level = ROLE_HIERARCHY.get(required_role, 0)
        return user_level >= required_level

    def can_manage_user(self, other_user: "User") -> bool:
        """Check if this user can manage another user."""
        return self.has_permission(other_user.role)
