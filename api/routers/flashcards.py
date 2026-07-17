"""Flashcard generation API endpoint.

Generates study flashcards from source or notebook content using AI.
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


class FlashcardGenerateRequest(BaseModel):
    source_id: Optional[str] = None
    notebook_id: Optional[str] = None
    num_flashcards: int = 10
    language: Optional[str] = None


class Flashcard(BaseModel):
    front: str
    back: str
    category: str = "general"


class FlashcardResponse(BaseModel):
    flashcards: list[Flashcard]
    source_count: int
    generated_from: str


async def _get_content_for_flashcards(source_id: Optional[str] = None, notebook_id: Optional[str] = None) -> tuple[str, str, int]:
    """Get content text and type for flashcard generation.

    Returns (content, source_type, source_count).
    """
    if source_id:
        source_id = ensure_record_id(source_id)
        results = await repo_query(f"SELECT * FROM {source_id};")
        if not results:
            raise HTTPException(status_code=404, detail="Source not found")
        source = results[0]
        content = source.get("full_text", "")
        if not content:
            raise HTTPException(status_code=400, detail="Source has no content to generate flashcards from")
        return content, f"source '{source.get('name', 'Unknown')}'", 1

    elif notebook_id:
        notebook_id = ensure_record_id(notebook_id)

        # Get notebook info
        nb_results = await repo_query(f"SELECT * FROM {notebook_id};")
        if not nb_results:
            raise HTTPException(status_code=404, detail="Notebook not found")
        notebook = nb_results[0]

        # Get all sources in notebook
        sources_results = await repo_query(
            f"SELECT ->has_source->source.* AS sources FROM {notebook_id};"
        )
        sources = sources_results[0].get("sources", []) if sources_results else []

        if not sources:
            raise HTTPException(status_code=400, detail="Notebook has no sources to generate flashcards from")

        # Combine all source content
        contents = []
        for src in sources:
            name = src.get("name", "Untitled")
            full_text = src.get("full_text", "")
            if full_text:
                contents.append(f"--- Source: {name} ---\n{full_text}")

        combined = "\n\n".join(contents)
        # Limit to ~50k chars to stay within LLM context
        if len(combined) > 50000:
            combined = combined[:50000] + "\n\n[Content truncated...]"

        return combined, f"notebook '{notebook.get('name', 'Unknown')}'", len(sources)

    else:
        raise HTTPException(status_code=400, detail="Either source_id or notebook_id must be provided")


FLASHCARD_PROMPT = """You are an expert educator creating study flashcards from content.

Generate exactly {num_flashcards} flashcards from the following content.

FORMAT: Return a JSON array of objects with "front", "back", and "category" fields.
- front: The question or prompt (clear, specific, testable)
- back: The answer (concise but complete)
- category: One of: "definition", "concept", "fact", "process", "comparison", "application"

RULES:
- Questions should test understanding, not just recall
- Mix difficulty levels (easy, medium, hard)
- Cover the most important concepts
- Keep answers concise (1-3 sentences max)
- Use clear, student-friendly language
- Do NOT include source references or IDs in the flashcards
- Return ONLY the JSON array, no other text

CONTENT:
{content}

JSON_ARRAY:"""


@router.post("/flashcards/generate", response_model=FlashcardResponse)
async def generate_flashcards(request: FlashcardGenerateRequest):
    """Generate study flashcards from a source or notebook using AI.

    Provide either source_id or notebook_id, not both.
    """
    try:
        if not request.source_id and not request.notebook_id:
            raise HTTPException(status_code=400, detail="Either source_id or notebook_id must be provided")
        if request.source_id and request.notebook_id:
            raise HTTPException(status_code=400, detail="Provide either source_id or notebook_id, not both")

        num_cards = max(5, min(30, request.num_flashcards))

        logger.info(f"Generating {num_cards} flashcards from {request.source_id or request.notebook_id}")

        content, source_type, source_count = await _get_content_for_flashcards(
            source_id=request.source_id,
            notebook_id=request.notebook_id,
        )

        # Truncate content for prompt
        if len(content) > 30000:
            content = content[:30000] + "\n\n[Content truncated for processing...]"

        prompt = FLASHCARD_PROMPT.format(num_flashcards=num_cards, content=content)

        # Use a model to generate flashcards
        model = await Model.get_default_model("outline")
        if not model:
            raise HTTPException(status_code=500, detail="No AI model available for flashcard generation")

        try:
            esperanto_model = await model.get_esperanto_model()
            response = await esperanto_model.ainvoke(prompt)
            response_text = response.content if hasattr(response, "content") else str(response)
        except Exception as model_error:
            logger.error(f"Model error during flashcard generation: {model_error}")
            raise HTTPException(status_code=500, detail=f"AI model error: {str(model_error)}")

        # Parse JSON response
        try:
            # Clean response - remove markdown code blocks if present
            cleaned = response_text.strip()
            if cleaned.startswith("```json"):
                cleaned = cleaned[7:]
            if cleaned.startswith("```"):
                cleaned = cleaned[3:]
            if cleaned.endswith("```"):
                cleaned = cleaned[:-3]
            cleaned = cleaned.strip()

            flashcards_data = json.loads(cleaned)

            if not isinstance(flashcards_data, list):
                raise ValueError("Response is not a JSON array")

            flashcards = []
            for card in flashcards_data:
                if isinstance(card, dict) and "front" in card and "back" in card:
                    flashcards.append(Flashcard(
                        front=card["front"],
                        back=card["back"],
                        category=card.get("category", "general"),
                    ))

            if not flashcards:
                raise ValueError("No valid flashcards found in response")

            logger.info(f"Successfully generated {len(flashcards)} flashcards from {source_type}")

            return FlashcardResponse(
                flashcards=flashcards,
                source_count=source_count,
                generated_from=source_type,
            )

        except (json.JSONDecodeError, ValueError) as parse_error:
            logger.error(f"Failed to parse flashcard response: {parse_error}\nResponse: {response_text[:500]}")
            raise HTTPException(
                status_code=500,
                detail=f"Failed to parse AI response as flashcards: {str(parse_error)}"
            )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error generating flashcards: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Failed to generate flashcards: {str(e)}")
