from datetime import datetime
from typing import ClassVar, Optional

from loguru import logger
from pydantic import Field, field_validator

from open_notebook.database.repository import repo_query
from open_notebook.domain.base import ObjectModel
from open_notebook.exceptions import DatabaseOperationError, InvalidInputError


class SignupRequest(ObjectModel):
    table_name: ClassVar[str] = "signup_request"
    nullable_fields: ClassVar[set[str]] = {"reviewed_by", "reviewed_at", "rejection_reason"}
    
    username: str
    email: Optional[str] = None
    password_hash: str
    display_name: Optional[str] = None
    referral_code: Optional[str] = None
    status: str = Field(default="pending")  # pending, approved, rejected
    reviewed_by: Optional[str] = None
    reviewed_at: Optional[datetime] = None
    rejection_reason: Optional[str] = None

    @field_validator("username")
    @classmethod
    def username_must_not_be_empty(cls, v):
        if not v.strip():
            raise InvalidInputError("Username cannot be empty")
        return v.strip()

    @field_validator("status")
    @classmethod
    def status_must_be_valid(cls, v):
        if v not in ("pending", "approved", "rejected"):
            raise InvalidInputError("Status must be 'pending', 'approved', or 'rejected'")
        return v

    @classmethod
    async def get_pending_requests(cls) -> list["SignupRequest"]:
        """Get all pending signup requests."""
        try:
            result = await repo_query(
                "SELECT * FROM signup_request WHERE status = 'pending' ORDER BY created ASC"
            )
            return [cls(**req) for req in result] if result else []
        except Exception as e:
            logger.error(f"Error fetching pending requests: {str(e)}")
            raise DatabaseOperationError(e)

    @classmethod
    async def get_by_username(cls, username: str) -> Optional["SignupRequest"]:
        """Find a signup request by username."""
        try:
            result = await repo_query(
                "SELECT * FROM signup_request WHERE username = $username",
                {"username": username},
            )
            if result:
                return cls(**result[0])
            return None
        except Exception as e:
            logger.error(f"Error fetching signup request: {str(e)}")
            raise DatabaseOperationError(e)

    async def approve(self, reviewer_id: str) -> bool:
        """Approve this signup request."""
        if self.status != "pending":
            return False
        
        self.status = "approved"
        self.reviewed_by = reviewer_id
        self.reviewed_at = datetime.now()
        await self.save()
        
        logger.info(f"Signup request approved: {self.username} by {reviewer_id}")
        return True

    async def reject(self, reviewer_id: str, reason: Optional[str] = None) -> bool:
        """Reject this signup request."""
        if self.status != "pending":
            return False
        
        self.status = "rejected"
        self.reviewed_by = reviewer_id
        self.reviewed_at = datetime.now()
        self.rejection_reason = reason
        await self.save()
        
        logger.info(f"Signup request rejected: {self.username} by {reviewer_id}")
        return True
