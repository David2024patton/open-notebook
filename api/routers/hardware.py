"""Hardware detection API endpoint.

Returns system hardware specs and recommended local model limits.
"""

import traceback
from typing import Optional

from fastapi import APIRouter, HTTPException
from loguru import logger
from pydantic import BaseModel

from open_notebook.utils.hardware import get_hardware_report
from open_notebook.utils.model_limiter import model_limiter

router = APIRouter()


class HardwareReport(BaseModel):
    os: str
    cpu: dict
    ram: dict
    gpus: list[dict]
    is_apple_silicon: bool
    is_cuda_available: bool
    is_rocm_available: bool
    max_concurrent_local_models: int
    recommended_max_model_size: str


class LimiterStatus(BaseModel):
    active_local_models: list[str]
    active_count: int
    max_concurrent: int
    hardware_detected: bool
    hardware_summary: dict


class LimiterConfig(BaseModel):
    max_concurrent_local_models: Optional[int] = None  # None = auto-detect


@router.get("/hardware", response_model=HardwareReport)
async def get_hardware():
    """Get system hardware report with local model recommendations."""
    try:
        return get_hardware_report()
    except Exception as e:
        logger.error(f"Error detecting hardware: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/hardware/limiter", response_model=LimiterStatus)
async def get_limiter_status():
    """Get current local model limiter status."""
    try:
        return await model_limiter.get_status()
    except Exception as e:
        logger.error(f"Error getting limiter status: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/hardware/limiter", response_model=LimiterStatus)
async def configure_limiter(request: LimiterConfig):
    """Configure local model concurrency limit.

    Set to null for auto-detect based on hardware.
    Set to 1-8 to manually override.
    WARNING: Setting higher than recommended may cause GPU OOM or system instability.
    """
    try:
        model_limiter.set_max_concurrent(request.max_concurrent_local_models)
        return await model_limiter.get_status()
    except Exception as e:
        logger.error(f"Error configuring limiter: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/hardware/rescan", response_model=HardwareReport)
async def rescan_hardware():
    """Force re-scan of hardware (e.g., after driver update)."""
    try:
        model_limiter._hardware = None  # Force re-detection
        return get_hardware_report()
    except Exception as e:
        logger.error(f"Error rescanning hardware: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))
