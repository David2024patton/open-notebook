from typing import ClassVar, Optional

from loguru import logger
from pydantic import Field

from open_notebook.database.repository import repo_query, ensure_record_id
from open_notebook.domain.base import ObjectModel


class UserTOTP(ObjectModel):
    """Stores TOTP 2FA secret for a user. Separate table because SurrealDB
    doesn't reliably persist new fields added to existing records."""
    table_name: ClassVar[str] = "user_totp"
    nullable_fields: ClassVar[set[str]] = set()
    
    user_id: str
    totp_secret: str
    totp_enabled: bool = Field(default=False)

    @classmethod
    async def get_by_user_id(cls, user_id: str) -> Optional["UserTOTP"]:
        """Find TOTP config by user ID."""
        try:
            result = await repo_query(
                "SELECT * FROM user_totp WHERE user_id = $user_id",
                {"user_id": user_id},
            )
            if result:
                return cls(**result[0])
            return None
        except Exception as e:
            logger.error(f"Error fetching TOTP config: {e}")
            return None
