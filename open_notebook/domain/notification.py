"""Notification system for multi-user mode."""

from datetime import datetime, timezone
from typing import Optional
from enum import Enum


class NotificationType(str, Enum):
    SIGNUP = "signup"
    REFERRAL = "referral"
    ROLE_CHANGE = "role_change"
    SYSTEM = "system"


class Notification:
    """Notification record for in-app alerts."""

    def __init__(
        self,
        for_user: str,
        title: str,
        message: str,
        notification_type: NotificationType,
        from_user: Optional[str] = None,
        link: Optional[str] = None,
        is_read: bool = False,
        created: Optional[datetime] = None,
        id: Optional[str] = None,
    ):
        self.id = id
        self.for_user = for_user
        self.from_user = from_user
        self.title = title
        self.message = message
        self.notification_type = notification_type
        self.is_read = is_read
        self.link = link
        self.created = created or datetime.now(timezone.utc)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "for_user": self.for_user,
            "from_user": self.from_user,
            "title": self.title,
            "message": self.message,
            "notification_type": self.notification_type.value,
            "is_read": self.is_read,
            "link": self.link,
            "created": self.created.isoformat() if self.created else None,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "Notification":
        created = data.get("created")
        if isinstance(created, str):
            try:
                created = datetime.fromisoformat(created.replace("Z", "+00:00"))
            except (ValueError, TypeError):
                created = datetime.now(timezone.utc)
            except (ValueError, TypeError):
                created = datetime.now(timezone.utc)
        elif created is None:
            created = datetime.now(timezone.utc)

        return cls(
            id=data.get("id"),
            for_user=data.get("for_user", ""),
            from_user=data.get("from_user"),
            title=data.get("title", ""),
            message=data.get("message", ""),
            notification_type=NotificationType(data.get("notification_type", "system")),
            is_read=data.get("is_read", False),
            link=data.get("link"),
            created=created,
        )


async def create_notification(
    for_user: str,
    title: str,
    message: str,
    notification_type: NotificationType,
    from_user: Optional[str] = None,
    link: Optional[str] = None,
) -> dict:
    """Create a new notification and return it as a dict."""
    from open_notebook.database.repository import repo_query

    result = await repo_query(
        """CREATE notification SET
            for_user = $for_user,
            from_user = $from_user,
            title = $title,
            message = $message,
            notification_type = $notification_type,
            is_read = false,
            link = $link,
            created = time::now();
        """,
        {
            "for_user": for_user,
            "from_user": from_user,
            "title": title,
            "message": message,
            "notification_type": notification_type.value,
            "link": link,
        },
    )
    if result:
        return result[0]
    return {}


async def get_user_notifications(
    user_id: str, unread_only: bool = False
) -> list[dict]:
    """Get notifications for a user."""
    from open_notebook.database.repository import repo_query

    query = "SELECT * FROM notification WHERE for_user = $user_id"
    params: dict = {"user_id": user_id}

    if unread_only:
        query += " AND is_read = false"

    query += " ORDER BY created DESC LIMIT 50;"
    result = await repo_query(query, params)
    return result


async def get_unread_count(user_id: str) -> int:
    """Get count of unread notifications for a user."""
    from open_notebook.database.repository import repo_query

    result = await repo_query(
        "SELECT count() FROM notification WHERE for_user = $user_id AND is_read = false GROUP ALL;",
        {"user_id": user_id},
    )
    if result and len(result) > 0:
        return result[0].get("count", 0)
    return 0


async def mark_as_read(notification_id: str) -> bool:
    """Mark a notification as read."""
    from open_notebook.database.repository import repo_query, ensure_record_id

    await repo_query(
        "UPDATE $id SET is_read = true;",
        {"id": ensure_record_id(notification_id)},
    )
    return True


async def mark_all_as_read(user_id: str) -> bool:
    """Mark all notifications for a user as read."""
    from open_notebook.database.repository import repo_query

    await repo_query(
        "UPDATE notification SET is_read = true WHERE for_user = $user_id AND is_read = false;",
        {"user_id": user_id},
    )
    return True


async def delete_notification(notification_id: str) -> bool:
    """Delete a notification."""
    from open_notebook.database.repository import repo_query, ensure_record_id

    await repo_query("DELETE $id;", {"id": ensure_record_id(notification_id)})
    return True


async def notify_admins_of_signup(
    new_user_name: str, new_user_role: str, referrer_name: Optional[str] = None
) -> None:
    """Notify superusers and admins when a new user signs up.

    Rules:
    - Superuser gets notified of ALL signups
    - Admin gets notified of user signups (not superuser signups)
    """
    from open_notebook.database.repository import repo_query

    # Get all superusers and admins
    users = await repo_query(
        "SELECT id, name, email, role FROM user WHERE role IN ['superuser', 'admin'];"
    )

    for u in users:
        recipient_role = u.get("role", "user")
        recipient_id = u.get("id", "")

        # Superuser gets all signup notifications
        if recipient_role == "superuser":
            title = "New Signup Request"
            msg = f"{new_user_name} ({new_user_role}) has submitted a signup request and needs approval."
            if referrer_name:
                msg += f" Referred by {referrer_name}."
            await create_notification(
                for_user=recipient_id,
                title=title,
                message=msg,
                notification_type=NotificationType.SIGNUP,
                link="/admin/users",
            )

        # Admin gets notified of user signups only (not superuser signups)
        elif recipient_role == "admin" and new_user_role != "superuser":
            title = "New Signup Request"
            msg = f"{new_user_name} ({new_user_role}) has submitted a signup request and needs approval."
            if referrer_name:
                msg += f" Referred by {referrer_name}."
            await create_notification(
                for_user=recipient_id,
                title=title,
                message=msg,
                notification_type=NotificationType.SIGNUP,
                link="/admin/users",
            )
