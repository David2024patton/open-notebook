"""Hardware detection module.

Scans system GPU, RAM, and CPU to determine safe local model limits.
Prevents running multiple local LLMs on consumer hardware.
"""

import os
import platform
import subprocess
import json
from dataclasses import dataclass, field
from typing import Optional
from loguru import logger


@dataclass
class GPUInfo:
    name: str = "Unknown"
    vram_mb: int = 0
    driver_version: str = "Unknown"
    cuda_version: str = "Unknown"
    compute_capability: str = "Unknown"


@dataclass
class SystemHardware:
    os: str = ""
    cpu_count: int = 0
    cpu_name: str = ""
    ram_total_mb: int = 0
    ram_available_mb: int = 0
    gpus: list[GPUInfo] = field(default_factory=list)
    is_apple_silicon: bool = False
    is_CUDA_available: bool = False
    is_ROCM_available: bool = False

    @property
    def total_vram_mb(self) -> int:
        return sum(g.vram_mb for g in self.gpus)

    @property
    def max_concurrent_local_models(self) -> int:
        """Determine max concurrent local models based on hardware."""
        if not self.gpus:
            # CPU only - very limited
            if self.ram_total_mb >= 32000:
                return 1  # 32GB+ RAM can run 1 small model on CPU
            return 0

        total_vram = self.total_vram_mb

        # Consumer GPU tiers
        if total_vram >= 24000:
            # RTX 3090/4090 class - can run 1 large or 2 small models
            return 2
        elif total_vram >= 16000:
            # RTX 4080/3080 16GB class
            return 1
        elif total_vram >= 12000:
            # RTX 3060 12GB class
            return 1
        elif total_vram >= 8000:
            # RTX 3060 8GB / 4060 class
            return 1
        elif total_vram >= 6000:
            # GTX 1660 class - barely enough for small models
            return 1
        else:
            # Very limited VRAM
            return 0

    @property
    def recommended_max_model_size(self) -> str:
        """Recommended max model size based on VRAM."""
        if not self.gpus:
            if self.ram_total_mb >= 32000:
                return "7B"
            elif self.ram_total_mb >= 16000:
                return "3B"
            return "1B"

        vram = self.total_vram_mb
        if vram >= 24000:
            return "70B"  # Quantized
        elif vram >= 16000:
            return "13B"
        elif vram >= 12000:
            return "7B"
        elif vram >= 8000:
            return "7B"
        elif vram >= 6000:
            return "3B"
        return "1B"


def _detect_nvidia_gpu() -> list[GPUInfo]:
    """Detect NVIDIA GPUs via nvidia-smi."""
    gpus = []
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,memory.total,driver_version,compute_cap", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=10,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
        if result.returncode == 0:
            for line in result.stdout.strip().split("\n"):
                if line.strip():
                    parts = [p.strip() for p in line.split(",")]
                    if len(parts) >= 4:
                        gpus.append(GPUInfo(
                            name=parts[0],
                            vram_mb=int(float(parts[1])),
                            driver_version=parts[2],
                            compute_capability=parts[3],
                        ))
    except (FileNotFoundError, subprocess.TimeoutExpired, Exception) as e:
        logger.debug(f"nvidia-smi not available: {e}")
    return gpus


def _detect_amd_gpu() -> list[GPUInfo]:
    """Detect AMD GPUs via rocm-smi."""
    gpus = []
    try:
        result = subprocess.run(
            ["rocm-smi", "--showmeminfo", "vram", "--json"],
            capture_output=True, text=True, timeout=10,
        )
        if result.returncode == 0:
            data = json.loads(result.stdout)
            for card in data.get("card0", []):
                gpus.append(GPUInfo(
                    name="AMD GPU",
                    vram_mb=card.get("vram_total", 0) // (1024 * 1024),
                ))
    except (FileNotFoundError, subprocess.TimeoutExpired, Exception):
        pass
    return gpus


def _detect_apple_silicon() -> bool:
    """Check if running on Apple Silicon."""
    if platform.system() == "Darwin":
        try:
            result = subprocess.run(["sysctl", "-n", "machdep.cpu.brand_string"],
                                    capture_output=True, text=True, timeout=5)
            return "Apple" in result.stdout
        except Exception:
            pass
    return False


def _get_ram_info() -> tuple[int, int]:
    """Get total and available RAM in MB."""
    try:
        if platform.system() == "Windows":
            import ctypes
            kernel32 = ctypes.windll.kernel32
            c_ulonglong = ctypes.c_ulonglong

            class MEMORYSTATUSEX(ctypes.Structure):
                _fields_ = [
                    ("dwLength", ctypes.c_ulong),
                    ("dwMemoryLoad", ctypes.c_ulong),
                    ("ullTotalPhys", c_ulonglong),
                    ("ullAvailPhys", c_ulonglong),
                    ("ullTotalPageFile", c_ulonglong),
                    ("ullAvailPageFile", c_ulonglong),
                    ("ullTotalVirtual", c_ulonglong),
                    ("ullAvailVirtual", c_ulonglong),
                    ("ullAvailExtendedVirtual", c_ulonglong),
                ]

            mem = MEMORYSTATUSEX()
            mem.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
            kernel32.GlobalMemoryStatusEx(ctypes.byref(mem))
            return mem.ullTotalPhys // (1024 * 1024), mem.ullAvailPhys // (1024 * 1024)

        elif platform.system() == "Linux":
            with open("/proc/meminfo") as f:
                lines = f.readlines()
            total = int(lines[0].split()[1]) // 1024
            available = int(lines[2].split()[1]) // 1024
            return total, available

        elif platform.system() == "Darwin":
            result = subprocess.run(["sysctl", "-n", "hw.memsize"], capture_output=True, text=True, timeout=5)
            total = int(result.stdout.strip()) // (1024 * 1024)
            return total, total // 2  # Rough estimate

    except Exception as e:
        logger.warning(f"Failed to get RAM info: {e}")
    return 0, 0


def _get_cpu_info() -> tuple[int, str]:
    """Get CPU count and name."""
    count = os.cpu_count() or 1
    name = "Unknown"
    try:
        if platform.system() == "Windows":
            import winreg
            key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"HARDWARE\DESCRIPTION\System\CentralProcessor\0")
            name = winreg.QueryValueEx(key, "ProcessorNameString")[0]
        elif platform.system() == "Linux":
            with open("/proc/cpuinfo") as f:
                for line in f:
                    if "model name" in line:
                        name = line.split(":")[1].strip()
                        break
        elif platform.system() == "Darwin":
            result = subprocess.run(["sysctl", "-n", "machdep.cpu.brand_string"], capture_output=True, text=True, timeout=5)
            name = result.stdout.strip()
    except Exception:
        pass
    return count, name


def detect_hardware() -> SystemHardware:
    """Detect full system hardware specs."""
    hw = SystemHardware()
    hw.os = platform.system()
    hw.cpu_count, hw.cpu_name = _get_cpu_info()
    hw.ram_total_mb, hw.ram_available_mb = _get_ram_info()
    hw.gpus = _detect_nvidia_gpu()
    hw.is_CUDA_available = len(hw.gpus) > 0
    hw.is_ROCM_available = len(_detect_amd_gpu()) > 0
    hw.is_apple_silicon = _detect_apple_silicon()

    if not hw.gpus:
        hw.gpus = _detect_amd_gpu()
        hw.is_ROCM_available = len(hw.gpus) > 0

    return hw


def get_hardware_report() -> dict:
    """Get formatted hardware report for API responses."""
    hw = detect_hardware()
    return {
        "os": hw.os,
        "cpu": {"name": hw.cpu_name, "cores": hw.cpu_count},
        "ram": {"total_mb": hw.ram_total_mb, "available_mb": hw.ram_available_mb},
        "gpus": [
            {"name": g.name, "vram_mb": g.vram_mb, "driver": g.driver_version}
            for g in hw.gpus
        ],
        "is_apple_silicon": hw.is_APPLE_SILICON,
        "is_cuda_available": hw.is_CUDA_available,
        "is_rocm_available": hw.is_ROCM_available,
        "max_concurrent_local_models": hw.max_concurrent_local_models,
        "recommended_max_model_size": hw.recommended_max_model_size,
    }
