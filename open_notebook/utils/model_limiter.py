"""Local model concurrency limiter.

Ensures only the allowed number of local models run simultaneously.
Default: 1 local model max to protect consumer GPUs.
"""

import asyncio
from typing import Optional
from loguru import logger

from open_notebook.utils.hardware import detect_hardware


class LocalModelLimiter:
    """Manages concurrent local model usage."""

    def __init__(self):
        self._active_models: dict[str, bool] = {}
        self._lock = asyncio.Lock()
        self._max_concurrent: Optional[int] = None
        self._hardware = None

    async def _ensure_hardware_detected(self):
        if self._hardware is None:
            self._hardware = detect_hardware()

    @property
    def max_concurrent(self) -> int:
        """Get max concurrent local models allowed."""
        if self._max_concurrent is not None:
            return self._max_concurrent
        if self._hardware:
            return self._hardware.max_concurrent_local_models
        return 1  # Safe default

    def set_max_concurrent(self, max_models: Optional[int]):
        """Override max concurrent (None = auto-detect from hardware)."""
        self._max_concurrent = max_models
        logger.info(f"Local model max concurrent set to: {max_models}")

    async def can_use_local_model(self, model_id: str) -> bool:
        """Check if we can start a new local model."""
        await self._ensure_hardware_detected()
        async with self._lock:
            if model_id in self._active_models:
                return True  # Already running
            active_count = len(self._active_models)
            max_allowed = self.max_concurrent
            if active_count >= max_allowed:
                logger.warning(
                    f"Local model limit reached: {active_count}/{max_allowed} active. "
                    f"Cannot start model {model_id}. Use an API provider instead."
                )
                return False
            return True

    async def acquire(self, model_id: str) -> bool:
        """Acquire a slot for a local model. Returns False if limit reached."""
        await self._ensure_hardware_detected()
        async with self._lock:
            if model_id in self._active_models:
                return True

            active_count = len(self._active_models)
            max_allowed = self.max_concurrent

            if active_count >= max_allowed:
                logger.warning(
                    f"Local model limit reached ({active_count}/{max_allowed}). "
                    f"Model '{model_id}' blocked. Use an API provider for concurrent workloads."
                )
                return False

            self._active_models[model_id] = True
            logger.info(f"Local model acquired: {model_id} ({active_count + 1}/{max_allowed})")
            return True

    async def release(self, model_id: str):
        """Release a local model slot."""
        async with self._lock:
            if model_id in self._active_models:
                del self._active_models[model_id]
                logger.info(f"Local model released: {model_id} ({len(self._active_models)}/{self.max_concurrent})")

    async def get_status(self) -> dict:
        """Get current limiter status."""
        await self._ensure_hardware_detected()
        async with self._lock:
            return {
                "active_local_models": list(self._active_models.keys()),
                "active_count": len(self._active_models),
                "max_concurrent": self.max_concurrent,
                "hardware_detected": self._hardware is not None,
                "hardware_summary": {
                    "total_vram_mb": self._hardware.total_vram_mb if self._hardware else 0,
                    "gpu_count": len(self._hardware.gpus) if self._hardware else 0,
                    "gpu_names": [g.name for g in self._hardware.gpus] if self._hardware else [],
                },
            }

    def is_local_model(self, provider: str) -> bool:
        """Check if a provider is local (not cloud API)."""
        local_providers = {
            "ollama", "llamafile", "llamacpp", "lmstudio",
            "kobold", "text-generation", "gpt4all",
        }
        return provider.lower() in local_providers


# Global singleton
model_limiter = LocalModelLimiter()
