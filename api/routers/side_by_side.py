"""Side-by-side viewer for source content.

Shows source content alongside chat/analysis for easy reference.
"""

from typing import Optional

from fastapi import APIRouter, HTTPException
from loguru import logger
from pydantic import BaseModel

from open_notebook.database.repository import repo_query, ensure_record_id

router = APIRouter()


class SideBySideRequest(BaseModel):
    source_id: str
    highlight_text: Optional[str] = None
    scroll_to: Optional[int] = None  # Line number or position


class SourceChunk(BaseModel):
    index: int
    text: str
    start_line: int
    end_line: int
    is_highlighted: bool = False


class SideBySideResponse(BaseModel):
    source_id: str
    source_name: str
    source_type: str
    full_text: str
    chunks: list[SourceChunk]
    total_lines: int
    metadata: Optional[dict] = None


class SourceSummary(BaseModel):
    source_id: str
    name: str
    source_type: str
    word_count: int
    char_count: int
    has_highlights: bool = False


@router.get("/side-by-side/{source_id}", response_model=SideBySideResponse)
async def get_source_content(
    source_id: str,
    highlight: Optional[str] = None,
    chunk_size: int = 50,
    offset: int = 0,
):
    """Get source content formatted for side-by-side viewing.

    Returns text in chunks for efficient rendering with optional highlighting.
    """
    try:
        source_id = ensure_record_id(source_id)

        results = await repo_query(f"SELECT * FROM {source_id};")
        if not results:
            raise HTTPException(status_code=404, detail="Source not found")

        source = results[0]
        full_text = source.get("full_text", "")
        lines = full_text.split("\n")

        # Find highlights if requested
        highlight_positions = set()
        if highlight and highlight.strip():
            search_lower = highlight.lower()
            for i, line in enumerate(lines):
                if search_lower in line.lower():
                    highlight_positions.add(i)

        # Create chunks
        chunks = []
        start = max(0, offset)
        end = min(len(lines), offset + chunk_size)

        for i in range(start, end):
            chunks.append(SourceChunk(
                index=i,
                text=lines[i],
                start_line=i,
                end_line=i,
                is_highlighted=i in highlight_positions,
            ))

        return SideBySideResponse(
            source_id=str(source.get("id", "")),
            source_name=source.get("name", "Untitled"),
            source_type=source.get("source_type", "unknown"),
            full_text=full_text,
            chunks=chunks,
            total_lines=len(lines),
            metadata={
                "offset": offset,
                "chunk_size": chunk_size,
                "has_more": end < len(lines),
            },
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting source content: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/side-by-side/summary/{notebook_id}")
async def get_sources_summary(notebook_id: str):
    """Get summary of all sources in a notebook for the side panel."""
    try:
        notebook_id = ensure_record_id(notebook_id)

        results = await repo_query(
            """SELECT ->has_source->source.* AS sources 
               FROM $notebook_id;""",
            {"notebook_id": notebook_id},
        )

        if not results or not results[0].get("sources"):
            return {"sources": []}

        sources = []
        for src in results[0]["sources"]:
            full_text = src.get("full_text", "")
            sources.append(SourceSummary(
                source_id=str(src.get("id", "")),
                name=src.get("name", "Untitled"),
                source_type=src.get("source_type", "unknown"),
                word_count=len(full_text.split()),
                char_count=len(full_text),
            ))

        return {"sources": sources}

    except Exception as e:
        logger.error(f"Error getting sources summary: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/side-by-side/search")
async def search_in_source(source_id: str, query: str, context_lines: int = 2):
    """Search within a source and return matches with context."""
    try:
        source_id = ensure_record_id(source_id)

        results = await repo_query(f"SELECT * FROM {source_id};")
        if not results:
            raise HTTPException(status_code=404, detail="Source not found")

        source = results[0]
        full_text = source.get("full_text", "")
        lines = full_text.split("\n")

        matches = []
        query_lower = query.lower()

        for i, line in enumerate(lines):
            if query_lower in line.lower():
                # Get context
                start = max(0, i - context_lines)
                end = min(len(lines), i + context_lines + 1)
                context = "\n".join(lines[start:end])

                matches.append({
                    "line_number": i,
                    "matched_text": line.strip(),
                    "context": context,
                    "start_line": start,
                    "end_line": end - 1,
                })

        return {
            "query": query,
            "total_matches": len(matches),
            "matches": matches[:50],  # Limit to 50 matches
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error searching in source: {e}")
        raise HTTPException(status_code=500, detail=str(e))
