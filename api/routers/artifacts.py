"""Artifacts API endpoints.

Generate various content artifacts from notebook/source content:
- Video overview scripts and metadata
- Chart/infographic data
- Presentation slides (PPTX)

These endpoints generate the content/structure that can be rendered
by frontend components or exported to files.
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


class ArtifactRequest(BaseModel):
    source_id: Optional[str] = None
    notebook_id: Optional[str] = None
    style: str = "educational"  # educational, narrative, technical
    language: Optional[str] = None


class VideoScript(BaseModel):
    title: str
    description: str
    scenes: list[dict]
    total_duration_seconds: int
    narration_text: str


class ChartData(BaseModel):
    title: str
    chart_type: str  # bar, pie, line, timeline, comparison
    data_points: list[dict]
    labels: list[str]
    description: str


class SlideDeck(BaseModel):
    title: str
    slides: list[dict]
    total_slides: int


async def _get_content(request: ArtifactRequest) -> tuple[str, str]:
    """Get content for artifact generation."""
    if request.source_id:
        source_id = ensure_record_id(request.source_id)
        results = await repo_query(f"SELECT * FROM {source_id};")
        if not results:
            raise HTTPException(status_code=404, detail="Source not found")
        source = results[0]
        content = source.get("full_text", "")
        name = source.get("name", "Source")
        if not content:
            raise HTTPException(status_code=400, detail="Source has no content")
        return content, name

    elif request.notebook_id:
        notebook_id = ensure_record_id(request.notebook_id)
        nb_results = await repo_query(f"SELECT * FROM {notebook_id};")
        if not nb_results:
            raise HTTPException(status_code=404, detail="Notebook not found")
        notebook = nb_results[0]

        sources_results = await repo_query(
            f"SELECT ->has_source->source.* AS sources FROM {notebook_id};"
        )
        sources = sources_results[0].get("sources", []) if sources_results else []

        if not sources:
            raise HTTPException(status_code=400, detail="Notebook has no sources")

        contents = []
        for src in sources:
            name = src.get("name", "Untitled")
            full_text = src.get("full_text", "")
            if full_text:
                contents.append(f"--- {name} ---\n{full_text[:3000]}")

        combined = "\n\n".join(contents)[:30000]
        return combined, notebook.get("name", "Notebook")

    else:
        raise HTTPException(status_code=400, detail="Either source_id or notebook_id must be provided")


# === VIDEO OVERVIEW ===

VIDEO_PROMPT = """Create a video overview script from the following content.

Style: {style}
Language: {language}

CONTENT:
{content}

Generate a JSON object with:
{{
  "title": "Video title",
  "description": "Brief description",
  "scenes": [
    {{
      "scene_number": 1,
      "title": "Scene title",
      "narration": "What the narrator says",
      "visual_description": "What appears on screen",
      "duration_seconds": 15
    }}
  ],
  "total_duration_seconds": 180,
  "narration_text": "Full narration text for TTS"
}}

Rules:
- 5-10 scenes
- Each scene 15-30 seconds
- Total 2-5 minutes
- Clear, engaging narration
- Visual descriptions for B-roll/text overlays
- Return ONLY the JSON, no other text

JSON:"""


@router.post("/artifacts/video", response_model=VideoScript)
async def generate_video_script(request: ArtifactRequest):
    """Generate a video overview script from content."""
    try:
        content, name = await _get_content(request)
        logger.info(f"Generating video script for: {name}")

        if len(content) > 20000:
            content = content[:20000] + "\n\n[Truncated...]"

        prompt = VIDEO_PROMPT.format(
            content=content,
            style=request.style,
            language=request.language or "English",
        )

        model = await Model.get_default_model("outline")
        if not model:
            raise HTTPException(status_code=500, detail="No AI model available")

        esperanto_model = await model.get_esperanto_model()
        response = await esperanto_model.ainvoke(prompt)
        response_text = response.content if hasattr(response, "content") else str(response)

        # Parse JSON
        cleaned = response_text.strip()
        if cleaned.startswith("```json"):
            cleaned = cleaned[7:]
        if cleaned.startswith("```"):
            cleaned = cleaned[3:]
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3]

        data = json.loads(cleaned.strip())
        return VideoScript(**data)

    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse video script: {e}")
        raise HTTPException(status_code=500, detail="Failed to parse AI response")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error generating video script: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


# === CHARTS / INFOGRAPHICS ===

CHART_PROMPT = """Analyze the following content and extract data suitable for visualization.

CONTENT:
{content}

Generate a JSON array of 1-3 chart data objects:
[
  {{
    "title": "Chart title",
    "chart_type": "bar|pie|line|timeline|comparison",
    "data_points": [
      {{"label": "Item A", "value": 42}},
      {{"label": "Item B", "value": 28}}
    ],
    "labels": ["Item A", "Item B"],
    "description": "What this chart shows"
  }}
]

Rules:
- Extract meaningful data from the content
- Choose the best chart type for each dataset
- Include 3-10 data points per chart
- Use clear, descriptive labels
- Return ONLY the JSON array, no other text

JSON_ARRAY:"""


@router.post("/artifacts/charts")
async def generate_charts(request: ArtifactRequest):
    """Generate chart data from content for infographics."""
    try:
        content, name = await _get_content(request)
        logger.info(f"Generating charts for: {name}")

        if len(content) > 15000:
            content = content[:15000] + "\n\n[Truncated...]"

        prompt = CHART_PROMPT.format(content=content)

        model = await Model.get_default_model("outline")
        if not model:
            raise HTTPException(status_code=500, detail="No AI model available")

        esperanto_model = await model.get_esperanto_model()
        response = await esperanto_model.ainvoke(prompt)
        response_text = response.content if hasattr(response, "content") else str(response)

        cleaned = response_text.strip()
        if cleaned.startswith("```json"):
            cleaned = cleaned[7:]
        if cleaned.startswith("```"):
            cleaned = cleaned[3:]
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3]

        data = json.loads(cleaned.strip())
        charts = [ChartData(**chart) for chart in data if isinstance(chart, dict)]
        return {"charts": charts, "source_name": name}

    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse chart data: {e}")
        raise HTTPException(status_code=500, detail="Failed to parse AI response")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error generating charts: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


# === SLIDES / PRESENTATION ===

SLIDES_PROMPT = """Create a presentation slide deck from the following content.

Style: {style}

CONTENT:
{content}

Generate a JSON object with:
{{
  "title": "Presentation title",
  "slides": [
    {{
      "slide_number": 1,
      "title": "Slide title",
      "content": "Main content/bullet points",
      "speaker_notes": "What the presenter says",
      "layout": "title|content|two-column|quote|chart"
    }}
  ],
  "total_slides": 10
}}

Rules:
- 8-15 slides
- First slide is always title slide
- Last slide is summary/key takeaways
- Mix different layouts for visual variety
- Content should be concise (bullet points, not paragraphs)
- Include speaker notes for each slide
- Return ONLY the JSON, no other text

JSON:"""


@router.post("/artifacts/slides", response_model=SlideDeck)
async def generate_slides(request: ArtifactRequest):
    """Generate presentation slides from content."""
    try:
        content, name = await _get_content(request)
        logger.info(f"Generating slides for: {name}")

        if len(content) > 20000:
            content = content[:20000] + "\n\n[Truncated...]"

        prompt = SLIDES_PROMPT.format(
            content=content,
            style=request.style,
        )

        model = await Model.get_default_model("outline")
        if not model:
            raise HTTPException(status_code=500, detail="No AI model available")

        esperanto_model = await model.get_esperanto_model()
        response = await esperanto_model.ainvoke(prompt)
        response_text = response.content if hasattr(response, "content") else str(response)

        cleaned = response_text.strip()
        if cleaned.startswith("```json"):
            cleaned = cleaned[7:]
        if cleaned.startswith("```"):
            cleaned = cleaned[3:]
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3]

        data = json.loads(cleaned.strip())
        return SlideDeck(**data)

    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse slides: {e}")
        raise HTTPException(status_code=500, detail="Failed to parse AI response")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error generating slides: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))
