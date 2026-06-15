"""MCP (Model Context Protocol) integration endpoints.

Provides standardized tool integrations following the MCP specification.
Allows external tools and services to connect to Open Notebook.
"""

import json
import traceback
from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from loguru import logger
from pydantic import BaseModel

router = APIRouter()


class MCPTool(BaseModel):
    name: str
    description: str
    input_schema: dict
    handler: Optional[str] = None


class MCPToolCall(BaseModel):
    tool_name: str
    arguments: dict


class MCPToolResponse(BaseModel):
    tool_name: str
    result: Any
    success: bool
    error: Optional[str] = None


# Registry of available MCP tools
MCP_TOOLS: list[MCPTool] = [
    MCPTool(
        name="search_notebooks",
        description="Search across all notebooks for content matching a query",
        input_schema={
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search query"},
                "limit": {"type": "integer", "description": "Max results", "default": 10},
            },
            "required": ["query"],
        },
    ),
    MCPTool(
        name="get_source_content",
        description="Get the full content of a specific source",
        input_schema={
            "type": "object",
            "properties": {
                "source_id": {"type": "string", "description": "Source ID"},
            },
            "required": ["source_id"],
        },
    ),
    MCPTool(
        name="list_notebooks",
        description="List all available notebooks",
        input_schema={
            "type": "object",
            "properties": {},
        },
    ),
    MCPTool(
        name="ask_question",
        description="Ask a question about notebook content and get an AI-powered answer",
        input_schema={
            "type": "object",
            "properties": {
                "question": {"type": "string", "description": "Question to ask"},
                "notebook_id": {"type": "string", "description": "Optional notebook to scope to"},
            },
            "required": ["question"],
        },
    ),
    MCPTool(
        name="generate_flashcards",
        description="Generate study flashcards from a source or notebook",
        input_schema={
            "type": "object",
            "properties": {
                "source_id": {"type": "string", "description": "Source ID"},
                "notebook_id": {"type": "string", "description": "Notebook ID"},
                "num_flashcards": {"type": "integer", "description": "Number of flashcards", "default": 10},
            },
        },
    ),
    MCPTool(
        name="get_stock_quote",
        description="Get real-time stock market data for a ticker symbol",
        input_schema={
            "type": "object",
            "properties": {
                "symbol": {"type": "string", "description": "Stock ticker symbol (e.g., AAPL)"},
            },
            "required": ["symbol"],
        },
    ),
    MCPTool(
        name="export_notebook",
        description="Export a notebook as Markdown, JSON, or PDF",
        input_schema={
            "type": "object",
            "properties": {
                "notebook_id": {"type": "string", "description": "Notebook ID"},
                "format": {"type": "string", "enum": ["markdown", "json", "pdf"], "description": "Export format"},
            },
            "required": ["notebook_id", "format"],
        },
    ),
]


@router.get("/mcp/tools", response_model=list[MCPTool])
async def list_mcp_tools():
    """List all available MCP tools."""
    return MCP_TOOLS


@router.get("/mcp/tools/{tool_name}", response_model=MCPTool)
async def get_mcp_tool(tool_name: str):
    """Get details about a specific MCP tool."""
    for tool in MCP_TOOLS:
        if tool.name == tool_name:
            return tool
    raise HTTPException(status_code=404, detail=f"Tool '{tool_name}' not found")


@router.post("/mcp/tools/{tool_name}/call", response_model=MCPToolResponse)
async def call_mcp_tool(tool_name: str, request: MCPToolCall):
    """Call an MCP tool with arguments."""
    try:
        # Find the tool
        tool = None
        for t in MCP_TOOLS:
            if t.name == tool_name:
                tool = t
                break

        if not tool:
            raise HTTPException(status_code=404, detail=f"Tool '{tool_name}' not found")

        # Execute the tool based on name
        if tool_name == "search_notebooks":
            from open_notebook.database.repository import repo_query
            query = request.arguments.get("query", "")
            limit = request.arguments.get("limit", 10)
            results = await repo_query(
                f"SELECT * FROM notebook WHERE name ~ '{query}' LIMIT {limit};"
            )
            result = {"notebooks": results or []}

        elif tool_name == "list_notebooks":
            from open_notebook.database.repository import repo_query
            results = await repo_query("SELECT * FROM notebook ORDER BY updated DESC;")
            result = {"notebooks": results or []}

        elif tool_name == "get_source_content":
            from open_notebook.database.repository import repo_query, ensure_record_id
            source_id = ensure_record_id(request.arguments.get("source_id", ""))
            results = await repo_query(f"SELECT * FROM {source_id};")
            result = {"source": results[0] if results else None}

        elif tool_name == "ask_question":
            # Placeholder - would integrate with the ask graph
            result = {"answer": "MCP ask_question not yet fully implemented", "question": request.arguments.get("question")}

        elif tool_name == "generate_flashcards":
            result = {"message": "Use POST /api/flashcards/generate instead"}

        elif tool_name == "get_stock_quote":
            result = {"message": "Use POST /api/finance/quotes instead"}

        elif tool_name == "export_notebook":
            result = {"message": "Use GET /api/notebooks/{id}/export/{format} instead"}

        else:
            result = {"error": "Tool not implemented"}

        return MCPToolResponse(
            tool_name=tool_name,
            result=result,
            success=True,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error calling MCP tool: {e}\n{traceback.format_exc()}")
        return MCPToolResponse(
            tool_name=tool_name,
            result=None,
            success=False,
            error=str(e),
        )


@router.get("/mcp/capabilities")
async def get_mcp_capabilities():
    """Get MCP server capabilities."""
    return {
        "protocol_version": "2024-11-05",
        "server_info": {
            "name": "open-notebook",
            "version": "1.0.0",
        },
        "capabilities": {
            "tools": {"listChanged": False},
            "resources": {"subscribe": False, "listChanged": False},
            "prompts": {"listChanged": False},
        },
        "tools": [t.name for t in MCP_TOOLS],
    }
