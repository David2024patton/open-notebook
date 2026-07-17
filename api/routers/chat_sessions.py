"""Multiple chat sessions per notebook.

Allows users to maintain separate research conversations
within a single notebook (e.g., "Literature Review", "Methodology", "Analysis").
"""

import json
import traceback
from typing import Optional

from fastapi import APIRouter, HTTPException
from loguru import logger
from pydantic import BaseModel

from open_notebook.database.repository import ensure_record_id, repo_query

router = APIRouter()


class ChatSessionCreate(BaseModel):
    notebook_id: str
    name: str
    description: Optional[str] = None
    system_prompt: Optional[str] = None


class ChatSessionUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    system_prompt: Optional[str] = None
    is_pinned: Optional[bool] = None


class ChatSessionResponse(BaseModel):
    id: str
    notebook_id: str
    name: str
    description: Optional[str] = None
    system_prompt: Optional[str] = None
    is_pinned: bool = False
    message_count: int = 0
    last_message_at: Optional[str] = None
    created: str
    updated: str


class ChatMessageCreate(BaseModel):
    role: str  # user, assistant, system
    content: str
    metadata: Optional[dict] = None


class ChatMessageResponse(BaseModel):
    id: str
    session_id: str
    role: str
    content: str
    metadata: Optional[dict] = None
    created: str


@router.post("/chat-sessions", response_model=ChatSessionResponse)
async def create_chat_session(request: ChatSessionCreate):
    """Create a new chat session within a notebook."""
    try:
        notebook_id = ensure_record_id(request.notebook_id)

        result = await repo_query(
            """CREATE chat_session SET
                notebook_id = $notebook_id,
                name = $name,
                description = $description,
                system_prompt = $system_prompt,
                is_pinned = false,
                message_count = 0,
                last_message_at = NONE,
                created = time::now(),
                updated = time::now()
            RETURN *;""",
            {
                "notebook_id": notebook_id,
                "name": request.name,
                "description": request.description,
                "system_prompt": request.system_prompt,
            },
        )

        if not result:
            raise HTTPException(status_code=500, detail="Failed to create chat session")

        # Link to notebook
        await repo_query(
            f"""RELATE {notebook_id}->has_chat_session->{result[0]['id']};"""
        )

        return _format_session(result[0])

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating chat session: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/chat-sessions", response_model=list[ChatSessionResponse])
async def list_chat_sessions(notebook_id: str):
    """List all chat sessions for a notebook."""
    try:
        notebook_id = ensure_record_id(notebook_id)

        results = await repo_query(
            """SELECT ->has_chat_session->chat_session.* AS sessions 
               FROM $notebook_id 
               ORDER BY is_pinned DESC, updated DESC;""",
            {"notebook_id": notebook_id},
        )

        if not results or not results[0].get("sessions"):
            return []

        sessions = results[0]["sessions"]
        return [_format_session(s) for s in sessions]

    except Exception as e:
        logger.error(f"Error listing chat sessions: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/chat-sessions/{session_id}", response_model=ChatSessionResponse)
async def get_chat_session(session_id: str):
    """Get a specific chat session."""
    try:
        session_id = ensure_record_id(session_id)
        results = await repo_query(f"SELECT * FROM {session_id};")

        if not results:
            raise HTTPException(status_code=404, detail="Chat session not found")

        return _format_session(results[0])

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting chat session: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/chat-sessions/{session_id}", response_model=ChatSessionResponse)
async def update_chat_session(session_id: str, request: ChatSessionUpdate):
    """Update a chat session."""
    try:
        session_id = ensure_record_id(session_id)

        updates = []
        params = {}

        if request.name is not None:
            updates.append("name = $name")
            params["name"] = request.name
        if request.description is not None:
            updates.append("description = $description")
            params["description"] = request.description
        if request.system_prompt is not None:
            updates.append("system_prompt = $system_prompt")
            params["system_prompt"] = request.system_prompt
        if request.is_pinned is not None:
            updates.append("is_pinned = $is_pinned")
            params["is_pinned"] = request.is_pinned

        if not updates:
            raise HTTPException(status_code=400, detail="No fields to update")

        updates.append("updated = time::now()")

        query = f"UPDATE {session_id} SET {', '.join(updates)} RETURN *;"
        results = await repo_query(query, params)

        if not results:
            raise HTTPException(status_code=404, detail="Chat session not found")

        return _format_session(results[0])

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating chat session: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/chat-sessions/{session_id}")
async def delete_chat_session(session_id: str):
    """Delete a chat session and all its messages."""
    try:
        session_id = ensure_record_id(session_id)

        # Delete all messages first
        await repo_query(f"DELETE chat_message WHERE session_id = $sid;", {"sid": session_id})

        # Delete the session
        await repo_query(f"DELETE {session_id};")

        return {"status": "deleted"}
    except Exception as e:
        logger.error(f"Error deleting chat session: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/chat-sessions/{session_id}/messages", response_model=ChatMessageResponse)
async def add_message(session_id: str, request: ChatMessageCreate):
    """Add a message to a chat session."""
    try:
        session_id = ensure_record_id(session_id)

        result = await repo_query(
            """CREATE chat_message SET
                session_id = $session_id,
                role = $role,
                content = $content,
                metadata = $metadata,
                created = time::now()
            RETURN *;""",
            {
                "session_id": session_id,
                "role": request.role,
                "content": request.content,
                "metadata": json.dumps(request.metadata) if request.metadata else None,
            },
        )

        if not result:
            raise HTTPException(status_code=500, detail="Failed to add message")

        # Update session message count and last message time
        await repo_query(
            f"""UPDATE {session_id} SET 
                message_count = math::add(message_count, 1),
                last_message_at = time::now(),
                updated = time::now();"""
        )

        return _format_message(result[0])

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error adding message: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/chat-sessions/{session_id}/messages", response_model=list[ChatMessageResponse])
async def list_messages(session_id: str, limit: int = 100):
    """List messages in a chat session."""
    try:
        session_id = ensure_record_id(session_id)

        results = await repo_query(
            """SELECT * FROM chat_message 
               WHERE session_id = $session_id 
               ORDER BY created ASC 
               LIMIT $limit;""",
            {"session_id": session_id, "limit": limit},
        )

        if not results:
            return []

        return [_format_message(m) for m in results]

    except Exception as e:
        logger.error(f"Error listing messages: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


def _format_session(session: dict) -> ChatSessionResponse:
    return ChatSessionResponse(
        id=str(session.get("id", "")),
        notebook_id=str(session.get("notebook_id", "")),
        name=session.get("name", ""),
        description=session.get("description"),
        system_prompt=session.get("system_prompt"),
        is_pinned=session.get("is_pinned", False),
        message_count=session.get("message_count", 0),
        last_message_at=str(session.get("last_message_at")) if session.get("last_message_at") else None,
        created=str(session.get("created", "")),
        updated=str(session.get("updated", "")),
    )


def _format_message(msg: dict) -> ChatMessageResponse:
    metadata = msg.get("metadata")
    if isinstance(metadata, str):
        try:
            metadata = json.loads(metadata)
        except (json.JSONDecodeError, TypeError):
            metadata = None

    return ChatMessageResponse(
        id=str(msg.get("id", "")),
        session_id=str(msg.get("session_id", "")),
        role=msg.get("role", ""),
        content=msg.get("content", ""),
        metadata=metadata,
        created=str(msg.get("created", "")),
    )
