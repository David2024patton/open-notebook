"""Analysis mode selection - Fast vs Deep.

Lets users choose between fast (cheap, shallow) and deep (expensive, thorough) analysis.
"""

from enum import Enum
from typing import Optional

from fastapi import APIRouter, HTTPException
from loguru import logger
from pydantic import BaseModel

from open_notebook.database.repository import repo_query, ensure_record_id

router = APIRouter()


class AnalysisMode(str, Enum):
    FAST = "fast"
    DEEP = "deep"


class ModeConfig(BaseModel):
    mode: AnalysisMode
    model_override: Optional[str] = None  # Override model for this mode
    max_tokens: Optional[int] = None
    temperature: Optional[float] = None
    use_chain_of_thought: bool = False
    use_multi_pass: bool = False


class ModeProfileCreate(BaseModel):
    notebook_id: Optional[str] = None
    name: str
    mode: AnalysisMode
    description: Optional[str] = None
    model_override: Optional[str] = None
    max_tokens: Optional[int] = None
    temperature: Optional[float] = None
    use_chain_of_thought: bool = False
    use_multi_pass: bool = False


class ModeProfileResponse(BaseModel):
    id: str
    notebook_id: Optional[str] = None
    name: str
    mode: str
    description: Optional[str] = None
    model_override: Optional[str] = None
    max_tokens: Optional[int] = None
    temperature: Optional[float] = None
    use_chain_of_thought: bool = False
    use_multi_pass: bool = False


# Default mode presets
MODE_PRESETS = {
    AnalysisMode.FAST: {
        "description": "Quick analysis with minimal tokens. Best for simple questions and brainstorming.",
        "max_tokens": 1024,
        "temperature": 0.7,
        "use_chain_of_thought": False,
        "use_multi_pass": False,
    },
    AnalysisMode.DEEP: {
        "description": "Thorough multi-step analysis. Best for complex research and verification.",
        "max_tokens": 4096,
        "temperature": 0.3,
        "use_chain_of_thought": True,
        "use_multi_pass": True,
    },
}


def get_mode_config(mode: AnalysisMode, profile: Optional[dict] = None) -> dict:
    """Get the effective configuration for a mode."""
    base = MODE_PRESETS[mode].copy()

    if profile:
        # Override with profile settings
        for key in ["max_tokens", "temperature", "use_chain_of_thought", "use_multi_pass", "model_override"]:
            if key in profile and profile[key] is not None:
                base[key] = profile[key]

    return base


@router.get("/modes/presets")
async def get_mode_presets():
    """Get built-in mode presets."""
    return {
        "fast": MODE_PRESETS[AnalysisMode.FAST],
        "deep": MODE_PRESETS[AnalysisMode.DEEP],
    }


@router.post("/modes/profiles", response_model=ModeProfileResponse)
async def create_mode_profile(request: ModeProfileCreate):
    """Create a custom mode profile."""
    try:
        result = await repo_query(
            """CREATE mode_profile SET
                notebook_id = $notebook_id,
                name = $name,
                mode = $mode,
                description = $description,
                model_override = $model_override,
                max_tokens = $max_tokens,
                temperature = $temperature,
                use_chain_of_thought = $use_cot,
                use_multi_pass = $use_multi_pass
            RETURN *;""",
            {
                "notebook_id": request.notebook_id,
                "name": request.name,
                "mode": request.mode.value,
                "description": request.description,
                "model_override": request.model_override,
                "max_tokens": request.max_tokens,
                "temperature": request.temperature,
                "use_cot": request.use_chain_of_thought,
                "use_multi_pass": request.use_multi_pass,
            },
        )

        if not result:
            raise HTTPException(status_code=500, detail="Failed to create mode profile")

        return _format_profile(result[0])

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating mode profile: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/modes/profiles", response_model=list[ModeProfileResponse])
async def list_mode_profiles(notebook_id: Optional[str] = None):
    """List mode profiles, optionally filtered by notebook."""
    try:
        query = "SELECT * FROM mode_profile"
        params = {}

        if notebook_id:
            query += " WHERE notebook_id = $notebook_id"
            params["notebook_id"] = notebook_id

        query += " ORDER BY name ASC"

        results = await repo_query(query, params)
        return [_format_profile(p) for p in (results or [])]

    except Exception as e:
        logger.error(f"Error listing mode profiles: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/modes/profiles/{profile_id}")
async def delete_mode_profile(profile_id: str):
    """Delete a mode profile."""
    try:
        profile_id = ensure_record_id(profile_id)
        await repo_query(f"DELETE {profile_id};")
        return {"status": "deleted"}
    except Exception as e:
        logger.error(f"Error deleting mode profile: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/modes/effective")
async def get_effective_mode(
    notebook_id: Optional[str] = None,
    profile_id: Optional[str] = None,
    mode: AnalysisMode = AnalysisMode.FAST,
):
    """Get effective mode configuration considering all overrides."""
    profile = None

    if profile_id:
        profile_id = ensure_record_id(profile_id)
        results = await repo_query(f"SELECT * FROM {profile_id};")
        if results:
            profile = results[0]
    elif notebook_id:
        notebook_id = ensure_record_id(notebook_id)
        results = await repo_query(
            """SELECT mode_profile.* FROM mode_profile 
               WHERE notebook_id = $notebook_id 
               LIMIT 1;""",
            {"notebook_id": notebook_id},
        )
        if results:
            profile = results[0]

    config = get_mode_config(mode, profile)
    config["mode"] = mode.value
    return config


def _format_profile(profile: dict) -> ModeProfileResponse:
    return ModeProfileResponse(
        id=str(profile.get("id", "")),
        notebook_id=profile.get("notebook_id"),
        name=profile.get("name", ""),
        mode=profile.get("mode", "fast"),
        description=profile.get("description"),
        model_override=profile.get("model_override"),
        max_tokens=profile.get("max_tokens"),
        temperature=profile.get("temperature"),
        use_chain_of_thought=profile.get("use_chain_of_thought", False),
        use_multi_pass=profile.get("use_multi_pass", False),
    )
