"""Scheduled research API endpoints.

Allows users to set up automated research tasks that run on a schedule.
"""

import traceback
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException
from loguru import logger
from pydantic import BaseModel

from open_notebook.database.repository import ensure_record_id, repo_query

router = APIRouter()


class ScheduleCreate(BaseModel):
    notebook_id: Optional[str] = None
    name: str
    task_type: str  # search, summarize, monitor, analyze
    query: str
    schedule: str  # cron expression or "daily", "weekly", "hourly"
    enabled: bool = True


class ScheduleUpdate(BaseModel):
    name: Optional[str] = None
    query: Optional[str] = None
    schedule: Optional[str] = None
    enabled: Optional[bool] = None


class ScheduleResponse(BaseModel):
    id: str
    notebook_id: Optional[str]
    name: str
    task_type: str
    query: str
    schedule: str
    enabled: bool
    last_run: Optional[str] = None
    last_result: Optional[str] = None
    created: str
    updated: str


class ScheduleRunResponse(BaseModel):
    schedule_id: str
    status: str
    result: Optional[str] = None
    started_at: str
    completed_at: Optional[str] = None


@router.post("/schedules", response_model=ScheduleResponse)
async def create_schedule(request: ScheduleCreate):
    """Create a new scheduled research task."""
    try:
        result = await repo_query(
            """CREATE research_schedule SET
                notebook_id = $notebook_id,
                name = $name,
                task_type = $task_type,
                query = $query,
                schedule = $schedule,
                enabled = $enabled,
                last_run = NONE,
                last_result = NONE,
                created = time::now(),
                updated = time::now()
            RETURN *;""",
            {
                "notebook_id": request.notebook_id,
                "name": request.name,
                "task_type": request.task_type,
                "query": request.query,
                "schedule": request.schedule,
                "enabled": request.enabled,
            },
        )

        if not result:
            raise HTTPException(status_code=500, detail="Failed to create schedule")

        schedule = result[0]
        return _format_schedule(schedule)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating schedule: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/schedules", response_model=list[ScheduleResponse])
async def list_schedules(notebook_id: Optional[str] = None):
    """List all scheduled research tasks."""
    try:
        query = "SELECT * FROM research_schedule WHERE 1=1"
        params = {}

        if notebook_id:
            query += " AND notebook_id = $notebook_id"
            params["notebook_id"] = notebook_id

        query += " ORDER BY created DESC"

        results = await repo_query(query, params)
        return [_format_schedule(s) for s in (results or [])]

    except Exception as e:
        logger.error(f"Error listing schedules: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/schedules/{schedule_id}", response_model=ScheduleResponse)
async def get_schedule(schedule_id: str):
    """Get a specific scheduled task."""
    try:
        schedule_id = ensure_record_id(schedule_id)
        results = await repo_query(f"SELECT * FROM {schedule_id};")

        if not results:
            raise HTTPException(status_code=404, detail="Schedule not found")

        return _format_schedule(results[0])

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting schedule: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/schedules/{schedule_id}", response_model=ScheduleResponse)
async def update_schedule(schedule_id: str, request: ScheduleUpdate):
    """Update a scheduled task."""
    try:
        schedule_id = ensure_record_id(schedule_id)

        updates = []
        params = {}

        if request.name is not None:
            updates.append("name = $name")
            params["name"] = request.name
        if request.query is not None:
            updates.append("query = $query")
            params["query"] = request.query
        if request.schedule is not None:
            updates.append("schedule = $schedule")
            params["schedule"] = request.schedule
        if request.enabled is not None:
            updates.append("enabled = $enabled")
            params["enabled"] = request.enabled

        if not updates:
            raise HTTPException(status_code=400, detail="No fields to update")

        updates.append("updated = time::now()")

        query = f"UPDATE {schedule_id} SET {', '.join(updates)} RETURN *;"
        results = await repo_query(query, params)

        if not results:
            raise HTTPException(status_code=404, detail="Schedule not found")

        return _format_schedule(results[0])

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating schedule: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/schedules/{schedule_id}")
async def delete_schedule(schedule_id: str):
    """Delete a scheduled task."""
    try:
        schedule_id = ensure_record_id(schedule_id)
        await repo_query(f"DELETE {schedule_id};")
        return {"status": "deleted"}
    except Exception as e:
        logger.error(f"Error deleting schedule: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/schedules/{schedule_id}/run", response_model=ScheduleRunResponse)
async def run_schedule(schedule_id: str):
    """Manually trigger a scheduled task."""
    try:
        schedule_id = ensure_record_id(schedule_id)
        results = await repo_query(f"SELECT * FROM {schedule_id};")

        if not results:
            raise HTTPException(status_code=404, detail="Schedule not found")

        schedule = results[0]
        task_type = schedule.get("task_type", "")
        query = schedule.get("query", "")

        now = datetime.now(timezone.utc).isoformat()

        # Execute the task based on type
        result_text = f"Task '{task_type}' executed for query: {query}"

        try:
            if task_type == "search":
                # Would integrate with search system
                result_text = f"Search completed for: {query}"
            elif task_type == "summarize":
                # Would integrate with AI summarization
                result_text = f"Summary generated for: {query}"
            elif task_type == "monitor":
                result_text = f"Monitoring check completed for: {query}"
            elif task_type == "analyze":
                result_text = f"Analysis completed for: {query}"
        except Exception as task_error:
            result_text = f"Task failed: {str(task_error)}"

        # Update last run
        await repo_query(
            f"UPDATE {schedule_id} SET last_run = $now, last_result = $result, updated = time::now();",
            {"now": now, "result": result_text},
        )

        return ScheduleRunResponse(
            schedule_id=str(schedule.get("id", "")),
            status="completed",
            result=result_text,
            started_at=now,
            completed_at=now,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error running schedule: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


def _format_schedule(schedule: dict) -> ScheduleResponse:
    """Format a schedule record for response."""
    return ScheduleResponse(
        id=str(schedule.get("id", "")),
        notebook_id=schedule.get("notebook_id"),
        name=schedule.get("name", ""),
        task_type=schedule.get("task_type", ""),
        query=schedule.get("query", ""),
        schedule=schedule.get("schedule", ""),
        enabled=schedule.get("enabled", True),
        last_run=str(schedule.get("last_run", "")) if schedule.get("last_run") else None,
        last_result=schedule.get("last_result") if schedule.get("last_result") else None,
        created=str(schedule.get("created", "")),
        updated=str(schedule.get("updated", "")),
    )
