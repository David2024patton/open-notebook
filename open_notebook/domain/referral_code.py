import secrets
from datetime import datetime
from typing import ClassVar, Optional

from loguru import logger
from pydantic import Field, field_validator

from open_notebook.database.repository import repo_query
from open_notebook.domain.base import ObjectModel
from open_notebook.exceptions import DatabaseOperationError, InvalidInputError


class ReferralCode(ObjectModel):
    table_name: ClassVar[str] = "referral_code"
    nullable_fields: ClassVar[set[str]] = {"used_by", "used_at"}
    
    code: str
    created_by: str  # User ID who created the code
    granted_role: str  # Role granted when code is used
    is_used: bool = Field(default=False)
    used_by: Optional[str] = None  # User ID who used the code
    used_at: Optional[datetime] = None

    @field_validator("code")
    @classmethod
    def code_must_not_be_empty(cls, v):
        if not v.strip():
            raise InvalidInputError("Referral code cannot be empty")
        return v.strip().upper()

    @field_validator("granted_role")
    @classmethod
    def granted_role_must_be_valid(cls, v):
        from open_notebook.domain.user import ROLES
        if v not in ROLES:
            raise InvalidInputError(f"Granted role must be one of: {', '.join(ROLES)}")
        return v

    @classmethod
    async def generate_code(cls, created_by: str, granted_role: str) -> "ReferralCode":
        """Generate a new unique referral code."""
        from open_notebook.domain.user import ROLES
        
        if granted_role not in ROLES:
            raise InvalidInputError(f"Invalid role: {granted_role}")
        
        # Generate a unique code
        code = secrets.token_urlsafe(8).upper()
        
        # Ensure code is unique
        while await cls.code_exists(code):
            code = secrets.token_urlsafe(8).upper()
        
        referral = cls(
            code=code,
            created_by=created_by,
            granted_role=granted_role,
        )
        await referral.save()
        
        logger.info(f"Referral code generated: {code} by user {created_by}")
        return referral

    @classmethod
    async def get_by_code(cls, code: str) -> Optional["ReferralCode"]:
        """Find a referral code by its code value."""
        try:
            result = await repo_query(
                "SELECT * FROM referral_code WHERE code = $code",
                {"code": code.upper()},
            )
            if result:
                return cls(**result[0])
            return None
        except Exception as e:
            logger.error(f"Error fetching referral code: {str(e)}")
            raise DatabaseOperationError(e)

    @classmethod
    async def code_exists(cls, code: str) -> bool:
        """Check if a referral code already exists."""
        ref = await cls.get_by_code(code)
        return ref is not None

    @classmethod
    async def get_by_creator(cls, creator_id: str) -> list["ReferralCode"]:
        """Get all referral codes created by a user."""
        try:
            result = await repo_query(
                "SELECT * FROM referral_code WHERE created_by = $creator_id ORDER BY created DESC",
                {"creator_id": creator_id},
            )
            return [cls(**ref) for ref in result] if result else []
        except Exception as e:
            logger.error(f"Error fetching referral codes: {str(e)}")
            raise DatabaseOperationError(e)

    @classmethod
    async def get_unused_by_role(cls, granted_role: str) -> list["ReferralCode"]:
        """Get all unused referral codes for a specific role."""
        try:
            result = await repo_query(
                "SELECT * FROM referral_code WHERE granted_role = $role AND is_used = false",
                {"role": granted_role},
            )
            return [cls(**ref) for ref in result] if result else []
        except Exception as e:
            logger.error(f"Error fetching unused referral codes: {str(e)}")
            raise DatabaseOperationError(e)

    async def use_code(self, user_id: str) -> bool:
        """Mark a referral code as used by a user."""
        if self.is_used:
            return False
        
        self.is_used = True
        self.used_by = user_id
        self.used_at = datetime.now()
        await self.save()
        
        logger.info(f"Referral code {self.code} used by user {user_id}")
        return True

    async def get_creator(self):
        """Get the user who created this code."""
        from open_notebook.domain.user import User
        return await User.get(self.created_by)
