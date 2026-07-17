"""Editable outputs API endpoints.

Allows users to save and manage edited versions of generated content.
"""

import json
import traceback
from typing import Optional

from fastapi import APIRouter, HTTPException
from loguru import logger
from pydantic import BaseModel

from open_notebook.database.repository import ensure_record_id, repo_query

router = APIRouter()


class EditableOutputCreate(BaseModel):
    notebook_id: Optional[str] = None
    source_id: Optional[str] = None
    output_type: str  # flashcards, video_script, chart, slides, export
    title: str
    content: str  # JSON string or markdown
    metadata: Optional[dict] = None


class EditableOutputUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    metadata: Optional[dict] = None


class EditableOutputResponse(BaseModel):
    id: str
    notebook_id: Optional[str]
    source_id: Optional[str]
    output_type: str
    title: str
    content: str
    metadata: Optional[dict]
    created: str
    updated: str


@router.post("/outputs", response_model=EditableOutputResponse)
async def create_output(request: EditableOutputCreate):
    """Create a new editable output."""
    try:
        result = await repo_query(
            """CREATE editable_output SET
                notebook_id = $notebook_id,
                source_id = $source_id,
                output_type = $output_type,
                title = $title,
                content = $content,
                metadata = $metadata,
                created = time::now(),
                updated = time::now()
            RETURN *;""",
            {
                "notebook_id": request.notebook_id,
                "source_id": request.source_id,
                "output_type": request.output_type,
                "title": request.title,
                "content": request.content,
                "metadata": json.dumps(request.metadata) if request.metadata else None,
            },
        )

        if not result:
            raise HTTPException(status_code=500, detail="Failed to create output")

        output = result[0]
        return EditableOutputResponse(
            id=str(output.get("id", "")),
            notebook_id=output.get("notebook_id"),
            source_id=output.get("source_id"),
            output_type=output.get("output_type", ""),
            title=output.get("title", ""),
            content=output.get("content", ""),
            metadata=json.loads(output.get("metadata", "{}")) if output.get("metadata") else None,
            created=str(output.get("created", "")),
            updated=str(output.get("updated", "")),
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating output: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/outputs", response_model=list[EditableOutputResponse])
async def list_outputs(
    notebook_id: Optional[str] = None,
    source_id: Optional[str] = None,
    output_type: Optional[str] = None,
):
    """List editable outputs with optional filters."""
    try:
        query = "SELECT * FROM editable_output WHERE 1=1"
        params = {}

        if notebook_id:
            query += " AND notebook_id = $notebook_id"
            params["notebook_id"] = notebook_id
        if source_id:
            query += " AND source_id = $source_id"
            params["source_id"] = source_id
        if output_type:
            query += " AND output_type = $output_type"
            params["output_type"] = output_type

        query += " ORDER BY updated DESC"

        results = await repo_query(query, params)

        return [
            EditableOutputResponse(
                id=str(o.get("id", "")),
                notebook_id=o.get("notebook_id"),
                source_id=o.get("source_id"),
                output_type=o.get("output_type", ""),
                title=o.get("title", ""),
                content=o.get("content", ""),
                metadata=json.loads(o.get("metadata", "{}")) if o.get("metadata") else None,
                created=str(o.get("created", "")),
                updated=str(o.get("updated", "")),
            )
            for o in (results or [])
        ]

    except Exception as e:
        logger.error(f"Error listing outputs: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/outputs/{output_id}", response_model=EditableOutputResponse)
async def get_output(output_id: str):
    """Get a single editable output."""
    try:
        output_id = ensure_record_id(output_id)
        results = await repo_query(f"SELECT * FROM {output_id};")

        if not results:
            raise HTTPException(status_code=404, detail="Output not found")

        output = results[0]
        return EditableOutputResponse(
            id=str(output.get("id", "")),
            notebook_id=output.get("notebook_id"),
            source_id=output.get("source_id"),
            output_type=output.get("output_type", ""),
            title=output.get("title", ""),
            content=output.get("content", ""),
            metadata=json.loads(output.get("metadata", "{}")) if output.get("metadata") else None,
            created=str(output.get("created", "")),
            updated=str(output.get("updated", "")),
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting output: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/outputs/{output_id}", response_model=EditableOutputResponse)
async def update_output(output_id: str, request: EditableOutputUpdate):
    """Update an editable output."""
    try:
        output_id = ensure_record_id(output_id)

        # Build update query
        updates = []
        params = {}

        if request.title is not None:
            updates.append("title = $title")
            params["title"] = request.title
        if request.content is not None:
            updates.append("content = $content")
            params["content"] = request.content
        if request.metadata is not None:
            updates.append("metadata = $metadata")
            params["metadata"] = json.dumps(request.metadata)

        if not updates:
            raise HTTPException(status_code=400, detail="No fields to update")

        updates.append("updated = time::now()")

        query = f"UPDATE {output_id} SET {', '.join(updates)} RETURN *;"
        results = await repo_query(query, params)

        if not results:
            raise HTTPException(status_code=404, detail="Output not found")

        output = results[0]
        return EditableOutputResponse(
            id=str(output.get("id", "")),
            notebook_id=output.get("notebook_id"),
            source_id=output.get("source_id"),
            output_type=output.get("output_type", ""),
            title=output.get("title", ""),
            content=output.get("content", ""),
            metadata=json.loads(output.get("metadata", "{}")) if output.get("metadata") else None,
            created=str(output.get("created", "")),
            updated=str(output.get("updated", "")),
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating output: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/outputs/{output_id}")
async def delete_output(output_id: str):
    """Delete an editable output."""
    try:
        output_id = ensure_record_id(output_id)
        await repo_query(f"DELETE {output_id};")
        return {"status": "deleted"}
    except Exception as e:
        logger.error(f"Error deleting output: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))
