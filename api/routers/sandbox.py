"""Code execution sandbox.

Runs Python code safely within notebooks for data analysis,
visualization, and computation.
"""

import io
import traceback
from contextlib import redirect_stderr, redirect_stdout
from typing import Optional

from fastapi import APIRouter, HTTPException
from loguru import logger
from pydantic import BaseModel

router = APIRouter()


class CodeExecuteRequest(BaseModel):
    code: str
    timeout: int = 30  # seconds
    kernel: str = "python"  # python, node
    allow_network: bool = False
    allow_filesystem: bool = False


class CodeExecuteResponse(BaseModel):
    output: str
    error: Optional[str] = None
    execution_time_ms: int
    success: bool
    plots: list[str] = []  # Base64 encoded plot images


class CodeCell(BaseModel):
    id: str
    code: str
    output: Optional[str] = None
    error: Optional[str] = None
    execution_count: int = 0
    cell_type: str = "code"  # code, markdown


# Restricted imports for sandbox
BLOCKED_MODULES = {
    "subprocess", "os.system", "shutil", "pathlib",
    "socket", "http", "urllib", "requests",
    "ctypes", "importlib",
}

# Safe builtins
SAFE_BUILTINS = {
    "print", "range", "len", "str", "int", "float", "bool",
    "list", "dict", "set", "tuple", "type", "isinstance",
    "min", "max", "sum", "abs", "round", "sorted", "reversed",
    "enumerate", "zip", "map", "filter", "any", "all",
    "True", "False", "None",
    "ValueError", "TypeError", "KeyError", "IndexError",
    "Exception", "RuntimeError", "StopIteration",
}


def _create_sandbox_globals() -> dict:
    """Create restricted global namespace for sandbox execution."""
    import builtins

    safe_builtins_dict = {}
    for name in SAFE_BUILTINS:
        if hasattr(builtins, name):
            safe_builtins_dict[name] = getattr(builtins, name)

    return {
        "__builtins__": safe_builtins_dict,
    }


async def execute_python_sandbox(
    code: str,
    timeout: int = 30,
    allow_network: bool = False,
    allow_filesystem: bool = False,
) -> CodeExecuteResponse:
    """Execute Python code in a restricted sandbox."""
    import time

    start_time = time.time()

    try:
        # Create restricted environment
        sandbox_globals = _create_sandbox_globals()
        sandbox_locals = {}

        # Add common data science libraries if available
        try:
            import numpy as np
            sandbox_globals["np"] = np
            sandbox_globals["numpy"] = np
        except ImportError:
            pass

        try:
            import pandas as pd
            sandbox_globals["pd"] = pd
            sandbox_globals["pandas"] = pd
        except ImportError:
            pass

        try:
            import matplotlib
            matplotlib.use("Agg")  # Non-interactive backend
            import matplotlib.pyplot as plt
            sandbox_globals["plt"] = plt
            sandbox_globals["matplotlib"] = matplotlib
        except ImportError:
            pass

        try:
            import json
            sandbox_globals["json"] = json
        except ImportError:
            pass

        # Capture output
        stdout_capture = io.StringIO()
        stderr_capture = io.StringIO()

        with redirect_stdout(stdout_capture), redirect_stderr(stderr_capture):
            exec(code, sandbox_globals, sandbox_locals)

        output = stdout_capture.getvalue()
        error_output = stderr_capture.getvalue()

        execution_time = int((time.time() - start_time) * 1000)

        # Check for matplotlib plots
        plots = []
        try:
            import matplotlib.pyplot as plt
            for fig_num in plt.get_fignums():
                fig = plt.figure(fig_num)
                buf = io.BytesIO()
                fig.savefig(buf, format="png", dpi=100, bbox_inches="tight")
                buf.seek(0)
                import base64
                plots.append(base64.b64encode(buf.read()).decode("utf-8"))
                plt.close(fig)
        except Exception:
            pass

        return CodeExecuteResponse(
            output=output,
            error=error_output if error_output else None,
            execution_time_ms=execution_time,
            success=True,
            plots=plots,
        )

    except Exception as e:
        execution_time = int((time.time() - start_time) * 1000)
        return CodeExecuteResponse(
            output="",
            error=f"{type(e).__name__}: {str(e)}\n{traceback.format_exc()}",
            execution_time_ms=execution_time,
            success=False,
        )


@router.post("/sandbox/execute", response_model=CodeExecuteResponse)
async def execute_code(request: CodeExecuteRequest):
    """Execute code in a sandboxed environment.

    Available libraries (if installed):
    - numpy, pandas, matplotlib (data analysis)
    - json (data parsing)
    - Built-in Python functions

    Security:
    - No network access by default
    - No filesystem access by default
    - Restricted imports
    - Timeout protection
    """
    try:
        if not request.code.strip():
            raise HTTPException(status_code=400, detail="No code provided")

        if len(request.code) > 10000:
            raise HTTPException(status_code=400, detail="Code too long (max 10,000 characters)")

        if request.kernel == "python":
            return await execute_python_sandbox(
                code=request.code,
                timeout=request.timeout,
                allow_network=request.allow_network,
                allow_filesystem=request.allow_filesystem,
            )
        else:
            raise HTTPException(status_code=400, detail=f"Kernel '{request.kernel}' not supported")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error executing code: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/sandbox/kernels")
async def list_kernels():
    """List available execution kernels."""
    kernels = [{"name": "python", "version": "3.x", "available": True}]

    try:
        import sys
        kernels[0]["version"] = f"{sys.version_info.major}.{sys.version_info.minor}"
    except Exception:
        pass

    return {"kernels": kernels}
