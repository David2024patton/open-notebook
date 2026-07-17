"""Source discovery API endpoint.

AI-powered source discovery that finds relevant web sources
based on notebook content or search queries.
"""

import json
import traceback
from typing import Optional

from fastapi import APIRouter, HTTPException
from loguru import logger
from pydantic import BaseModel

from open_notebook.ai.models import Model
from open_notebook.database.repository import ensure_record_id, repo_query

router = APIRouter()


class DiscoverRequest(BaseModel):
    query: Optional[str] = None
    notebook_id: Optional[str] = None
    num_results: int = 5


class DiscoveredSource(BaseModel):
    url: str
    title: str
    description: str
    relevance_score: float
    source_type: str = "url"


class DiscoverResponse(BaseModel):
    sources: list[DiscoveredSource]
    search_query: str
    based_on: str


DISCOVERY_PROMPT = """You are a research assistant that finds relevant web sources.

Based on the following context, suggest {num_results} high-quality web sources that would be useful for further research.

CONTEXT:
{context}

For each source, provide:
- url: The full URL (must be valid and accessible)
- title: A clear, descriptive title
- description: A brief description of what the source contains (1-2 sentences)
- relevance_score: A score from 0.0 to 1.0 indicating relevance
- source_type: One of "url", "youtube", "arxiv", "github"

IMPORTANT:
- Only suggest real, accessible URLs
- Prioritize authoritative, high-quality sources
- Focus on sources that complement the existing content
- Include a mix of source types when relevant
- Do NOT suggest sources that are already in the context

Return a JSON array of source objects. Return ONLY the JSON array, no other text.

JSON_ARRAY:"""


async def _get_notebook_context(notebook_id: str) -> str:
    """Get summarized context from a notebook for discovery."""
    notebook_id = ensure_record_id(notebook_id)

    # Get notebook info
    nb_results = await repo_query(f"SELECT * FROM {notebook_id};")
    if not nb_results:
        raise HTTPException(status_code=404, detail="Notebook not found")
    notebook = nb_results[0]

    # Get sources
    sources_results = await repo_query(
        f"SELECT ->has_source->source.name, ->has_source->source.full_text AS sources FROM {notebook_id};"
    )
    sources = sources_results[0].get("sources", []) if sources_results else []

    # Build context from source names and first few paragraphs
    context_parts = [f"Notebook: {notebook.get('name', 'Unknown')}"]
    if notebook.get("description"):
        context_parts.append(f"Description: {notebook['description']}")

    context_parts.append(f"\nExisting sources ({len(sources)}):")
    for src in sources[:10]:  # Limit to 10 sources for context
        name = src.get("name", "Untitled")
        full_text = src.get("full_text", "")
        # Take first 500 chars as summary
        summary = full_text[:500] + "..." if len(full_text) > 500 else full_text
        context_parts.append(f"- {name}: {summary}")

    return "\n".join(context_parts)


async def _search_web(query: str) -> list[dict]:
    """Search the web using available tools.

    This is a simplified web search that returns placeholder results.
    In production, integrate with a real search API (SerpAPI, Tavily, etc.)
    """
    # For now, return a helpful message that the user should use the query
    # In a real implementation, this would call a search API
    try:
        # Try to use the firecrawl or similar tool if available
        from content_core.tools import web_search
        results = await web_search(query, max_results=5)
        return results
    except (ImportError, Exception) as e:
        logger.warning(f"Web search not available: {e}")
        return []


@router.post("/sources/discover", response_model=DiscoverResponse)
async def discover_sources(request: DiscoverRequest):
    """Discover relevant web sources using AI.

    Provide either a search query or notebook_id to find sources for.
    """
    try:
        if not request.query and not request.notebook_id:
            raise HTTPException(status_code=400, detail="Either query or notebook_id must be provided")

        num_results = max(1, min(10, request.num_results))

        # Build context for discovery
        if request.notebook_id:
            context = await _get_notebook_context(request.notebook_id)
            search_query = f"Find sources related to: {context[:500]}"
            based_on = "notebook content"
        else:
            context = f"Search query: {request.query}"
            search_query = request.query
            based_on = "search query"

        logger.info(f"Discovering sources for: {search_query[:100]}")

        # Use AI to suggest relevant sources
        prompt = DISCOVERY_PROMPT.format(num_results=num_results, context=context)

        model = await Model.get_default_model("outline")
        if not model:
            raise HTTPException(status_code=500, detail="No AI model available for source discovery")

        try:
            esperanto_model = await model.get_esperanto_model()
            response = await esperanto_model.ainvoke(prompt)
            response_text = response.content if hasattr(response, "content") else str(response)
        except Exception as model_error:
            logger.error(f"Model error during source discovery: {model_error}")
            raise HTTPException(status_code=500, detail=f"AI model error: {str(model_error)}")

        # Parse JSON response
        try:
            cleaned = response_text.strip()
            if cleaned.startswith("```json"):
                cleaned = cleaned[7:]
            if cleaned.startswith("```"):
                cleaned = cleaned[3:]
            if cleaned.endswith("```"):
                cleaned = cleaned[:-3]
            cleaned = cleaned.strip()

            sources_data = json.loads(cleaned)

            if not isinstance(sources_data, list):
                raise ValueError("Response is not a JSON array")

            sources = []
            for src in sources_data:
                if isinstance(src, dict) and "url" in src and "title" in src:
                    sources.append(DiscoveredSource(
                        url=src["url"],
                        title=src["title"],
                        description=src.get("description", ""),
                        relevance_score=float(src.get("relevance_score", 0.5)),
                        source_type=src.get("source_type", "url"),
                    ))

            if not sources:
                raise ValueError("No valid sources found in response")

            logger.info(f"Discovered {len(sources)} sources")

            return DiscoverResponse(
                sources=sources,
                search_query=search_query[:200],
                based_on=based_on,
            )

        except (json.JSONDecodeError, ValueError) as parse_error:
            logger.error(f"Failed to parse discovery response: {parse_error}\nResponse: {response_text[:500]}")
            raise HTTPException(
                status_code=500,
                detail=f"Failed to parse AI response as sources: {str(parse_error)}"
            )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error discovering sources: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Failed to discover sources: {str(e)}")
