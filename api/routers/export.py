"""Export API endpoints for notebooks and sources.

Provides PDF, Markdown, and JSON export functionality.
All exports include proper error handling and logging.
"""

import json
import traceback
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from loguru import logger
from pydantic import BaseModel

from open_notebook.database.repository import repo_query, ensure_record_id

router = APIRouter()


class ExportRequest(BaseModel):
    format: str  # "markdown", "json", "pdf"


async def _get_notebook_data(notebook_id: str) -> dict:
    """Get notebook data including sources, notes, and insights."""
    notebook_id = ensure_record_id(notebook_id)

    # Get notebook basic info
    results = await repo_query(
        f"SELECT * FROM {notebook_id};",
    )
    if not results:
        raise HTTPException(status_code=404, detail="Notebook not found")
    notebook_data = results[0]

    # Get sources
    sources_results = await repo_query(
        f"SELECT ->has_source->source.* AS sources FROM {notebook_id};",
    )
    sources = sources_results[0].get("sources", []) if sources_results else []

    # Get notes
    notes_results = await repo_query(
        f"SELECT ->has_note->note.* AS notes FROM {notebook_id};",
    )
    notes = notes_results[0].get("notes", []) if notes_results else []

    # Get insights
    insights_results = await repo_query(
        f"SELECT ->has_insight->source_insight.* AS insights FROM {notebook_id};",
    )
    insights = insights_results[0].get("insights", []) if insights_results else []

    notebook_data["sources"] = sources or []
    notebook_data["notes"] = notes or []
    notebook_data["insights"] = insights or []

    return notebook_data


async def _get_source_data(source_id: str) -> dict:
    """Get source data."""
    source_id = ensure_record_id(source_id)

    results = await repo_query(
        f"SELECT * FROM {source_id};",
    )
    if not results:
        raise HTTPException(status_code=404, detail="Source not found")
    return results[0]


def _serialize_source(source: dict) -> dict:
    """Serialize a source to a JSON-serializable dict."""
    return {
        "id": str(source.get("id", "")),
        "name": source.get("name", ""),
        "content": source.get("full_text", ""),
        "url": source.get("url", ""),
        "source_type": source.get("source_type", ""),
        "created": str(source.get("created", "")),
        "updated": str(source.get("updated", "")),
    }


def _notebook_to_markdown(notebook: dict) -> str:
    """Convert notebook content to Markdown format."""
    lines = [
        f"# {notebook.get('name', 'Untitled Notebook')}",
        "",
        f"*Exported on {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}*",
        "",
    ]

    description = notebook.get("description", "")
    if description:
        lines.extend([description, ""])

    # Get sources
    sources = notebook.get("sources", [])
    if sources:
        lines.extend(["## Sources", ""])
        for i, source in enumerate(sources, 1):
            name = source.get("name", f"Source {i}")
            content = source.get("full_text", "")
            url = source.get("url", "")
            lines.extend([
                f"### {i}. {name}",
                "",
            ])
            if url:
                lines.extend([f"**URL:** {url}", ""])
            if content:
                lines.extend([content, ""])
            lines.append("---")
            lines.append("")

    # Get notes
    notes = notebook.get("notes", [])
    if notes:
        lines.extend(["## Notes", ""])
        for note in notes:
            title = note.get("title", "Untitled")
            content = note.get("content", "")
            lines.extend([f"### {title}", "", content, ""])

    # Get insights
    insights = notebook.get("insights", [])
    if insights:
        lines.extend(["## Insights", ""])
        for insight in insights:
            insight_type = insight.get("insight_type", "Insight")
            content = insight.get("content", "")
            lines.extend([f"### {insight_type}", "", content, ""])

    return "\n".join(lines)


def _notebook_to_json(notebook: dict) -> dict:
    """Convert notebook content to JSON format."""
    sources = notebook.get("sources", [])
    notes = notebook.get("notes", [])
    insights = notebook.get("insights", [])

    return {
        "name": notebook.get("name", ""),
        "description": notebook.get("description", ""),
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "sources": [_serialize_source(s) for s in sources],
        "notes": [
            {
                "id": str(n.get("id", "")),
                "title": n.get("title", ""),
                "content": n.get("content", ""),
            }
            for n in notes
        ],
        "insights": [
            {
                "id": str(ins.get("id", "")),
                "type": ins.get("insight_type", ""),
                "content": ins.get("content", ""),
            }
            for ins in insights
        ],
    }


@router.get("/notebooks/{notebook_id}/export/{format}")
async def export_notebook(notebook_id: str, format: str):
    """Export a notebook as Markdown, JSON, or PDF.

    - **format**: markdown, json, or pdf
    """
    try:
        logger.info(f"Exporting notebook {notebook_id} as {format}")

        notebook = await _get_notebook_data(notebook_id)

        if format == "markdown":
            content = _notebook_to_markdown(notebook)
            safe_name = (notebook.get("name", "notebook") or "notebook").replace(" ", "_").replace("/", "_")
            filename = f"{safe_name}.md"

            return StreamingResponse(
                iter([content.encode("utf-8")]),
                media_type="text/markdown",
                headers={"Content-Disposition": f'attachment; filename="{filename}"'},
            )

        elif format == "json":
            data = _notebook_to_json(notebook)
            content = json.dumps(data, indent=2, ensure_ascii=False)
            safe_name = (notebook.get("name", "notebook") or "notebook").replace(" ", "_").replace("/", "_")
            filename = f"{safe_name}.json"

            return StreamingResponse(
                iter([content.encode("utf-8")]),
                media_type="application/json",
                headers={"Content-Disposition": f'attachment; filename="{filename}"'},
            )

        elif format == "pdf":
            # Generate markdown first, then convert to PDF
            markdown_content = _notebook_to_markdown(notebook)
            safe_name = (notebook.get("name", "notebook") or "notebook").replace(" ", "_").replace("/", "_")
            filename = f"{safe_name}.pdf"

            try:
                from weasyprint import HTML
                import markdown as md

                html_content = md.markdown(markdown_content, extensions=["tables", "fenced_code"])
                full_html = f"""<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; max-width: 800px; margin: 0 auto; padding: 20px; color: #333; }}
h1 {{ color: #1a1a1a; border-bottom: 2px solid #e0e0e0; padding-bottom: 8px; }}
h2 {{ color: #2a2a2a; margin-top: 24px; }}
h3 {{ color: #3a3a3a; }}
code {{ background: #f5f5f5; padding: 2px 4px; border-radius: 3px; font-size: 0.9em; }}
pre {{ background: #f5f5f5; padding: 12px; border-radius: 6px; overflow-x: auto; }}
blockquote {{ border-left: 3px solid #ddd; margin: 0; padding-left: 16px; color: #666; }}
table {{ border-collapse: collapse; width: 100%; }}
th, td {{ border: 1px solid #ddd; padding: 8px; text-align: left; }}
th {{ background: #f5f5f5; }}
</style>
</head>
<body>{html_content}</body>
</html>"""

                pdf_bytes = HTML(string=full_html).write_pdf()
                return StreamingResponse(
                    iter([pdf_bytes]),
                    media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'},
                )
            except ImportError:
                logger.warning("weasyprint not available, falling back to markdown export")
                content = _notebook_to_markdown(notebook)
                safe_name = (notebook.get("name", "notebook") or "notebook").replace(" ", "_").replace("/", "_")
                filename = f"{safe_name}.md"
                return StreamingResponse(
                    iter([content.encode("utf-8")]),
                    media_type="text/markdown",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'},
                )
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported format: {format}. Use 'markdown', 'json', or 'pdf'.")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error exporting notebook {notebook_id}: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Failed to export notebook: {str(e)}")


@router.get("/sources/{source_id}/export/{format}")
async def export_source(source_id: str, format: str):
    """Export a source as Markdown, JSON, or PDF.

    - **format**: markdown, json, or pdf
    """
    try:
        logger.info(f"Exporting source {source_id} as {format}")

        source = await _get_source_data(source_id)

        name = source.get("name", "source") or "source"
        safe_name = name.replace(" ", "_").replace("/", "_")
        content = source.get("full_text", "")
        url = source.get("url", "")

        if format == "markdown":
            md_content = f"# {name}\n\n"
            if url:
                md_content += f"**Source URL:** {url}\n\n"
            md_content += content

            filename = f"{safe_name}.md"
            return StreamingResponse(
                iter([md_content.encode("utf-8")]),
                media_type="text/markdown",
                headers={"Content-Disposition": f'attachment; filename="{filename}"'},
            )

        elif format == "json":
            data = _serialize_source(source)
            json_content = json.dumps(data, indent=2, ensure_ascii=False)
            filename = f"{safe_name}.json"

            return StreamingResponse(
                iter([json_content.encode("utf-8")]),
                media_type="application/json",
                headers={"Content-Disposition": f'attachment; filename="{filename}"'},
            )

        elif format == "pdf":
            try:
                from weasyprint import HTML
                import markdown as md

                md_content = f"# {name}\n\n"
                if url:
                    md_content += f"**Source URL:** {url}\n\n"
                md_content += content

                html_content = md.markdown(md_content, extensions=["tables", "fenced_code"])
                full_html = f"""<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; max-width: 800px; margin: 0 auto; padding: 20px; color: #333; }}
h1 {{ color: #1a1a1a; border-bottom: 2px solid #e0e0e0; padding-bottom: 8px; }}
code {{ background: #f5f5f5; padding: 2px 4px; border-radius: 3px; font-size: 0.9em; }}
pre {{ background: #f5f5f5; padding: 12px; border-radius: 6px; overflow-x: auto; }}
</style>
</head>
<body>{html_content}</body>
</html>"""

                pdf_bytes = HTML(string=full_html).write_pdf()
                filename = f"{safe_name}.pdf"
                return StreamingResponse(
                    iter([pdf_bytes]),
                    media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'},
                )
            except ImportError:
                logger.warning("weasyprint not available, falling back to markdown export")
                md_content = f"# {name}\n\n"
                if url:
                    md_content += f"**Source URL:** {url}\n\n"
                md_content += content
                filename = f"{safe_name}.md"
                return StreamingResponse(
                    iter([md_content.encode("utf-8")]),
                    media_type="text/markdown",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'},
                )
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported format: {format}. Use 'markdown', 'json', or 'pdf'.")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error exporting source {source_id}: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Failed to export source: {str(e)}")
