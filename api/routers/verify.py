"""Multi-agent verification API endpoints.

Cross-checks information across multiple sources using multiple AI agents
to improve accuracy and identify contradictions.
"""

import json
import traceback
from typing import Optional

from fastapi import APIRouter, HTTPException
from loguru import logger
from pydantic import BaseModel

from open_notebook.database.repository import ensure_record_id, repo_query

router = APIRouter()


class VerifyRequest(BaseModel):
    claim: str
    source_ids: Optional[list[str]] = None
    notebook_id: Optional[str] = None
    num_agents: int = 3


class AgentVerification(BaseModel):
    agent_id: int
    verdict: str  # supported, contradicted, inconclusive
    confidence: float
    evidence: str
    sources_used: list[str]


class VerifyResponse(BaseModel):
    claim: str
    overall_verdict: str
    confidence: float
    agent_verifications: list[AgentVerification]
    summary: str
    contradictions: list[str]


VERIFICATION_PROMPT = """You are Agent {agent_id}, an independent fact-checker.

Verify the following claim using ONLY the provided sources.

CLAIM: {claim}

SOURCES:
{sources}

Your task:
1. Evaluate if the claim is SUPPORTED, CONTRADICTED, or INCONCLUSIVE based on the sources
2. Assign a confidence level (0.0 to 1.0)
3. Provide evidence from the sources
4. List which sources you used

Return a JSON object:
{{
  "verdict": "supported|contradicted|inconclusive",
  "confidence": 0.85,
  "evidence": "Specific quotes or information from sources that support your verdict",
  "sources_used": ["source_id_1", "source_id_2"]
}}

Be objective and independent. Do not coordinate with other agents.
Return ONLY the JSON object, no other text.

JSON:"""


async def _get_sources_context(source_ids: Optional[list[str]] = None, notebook_id: Optional[str] = None) -> list[dict]:
    """Get source content for verification."""
    sources = []

    if source_ids:
        for sid in source_ids[:5]:  # Limit to 5 sources
            try:
                sid = ensure_record_id(sid)
                results = await repo_query(f"SELECT * FROM {sid};")
                if results:
                    src = results[0]
                    sources.append({
                        "id": str(src.get("id", "")),
                        "name": src.get("name", "Untitled"),
                        "content": src.get("full_text", "")[:3000],  # Limit content
                    })
            except Exception as e:
                logger.warning(f"Failed to load source {sid}: {e}")
    elif notebook_id:
        notebook_id = ensure_record_id(notebook_id)
        results = await repo_query(
            f"SELECT ->has_source->source.* AS sources FROM {notebook_id};"
        )
        if results:
            for src in results[0].get("sources", [])[:5]:
                sources.append({
                    "id": str(src.get("id", "")),
                    "name": src.get("name", "Untitled"),
                    "content": src.get("full_text", "")[:3000],
                })

    return sources


@router.post("/verify", response_model=VerifyResponse)
async def verify_claim(request: VerifyRequest):
    """Verify a claim using multiple independent AI agents.

    Each agent independently evaluates the claim against the sources,
    then results are aggregated for a final verdict.
    """
    try:
        if not request.source_ids and not request.notebook_id:
            raise HTTPException(status_code=400, detail="Either source_ids or notebook_id required")

        sources = await _get_sources_context(request.source_ids, request.notebook_id)
        if not sources:
            raise HTTPException(status_code=400, detail="No sources found for verification")

        logger.info(f"Verifying claim with {request.num_agents} agents: {request.claim[:100]}")

        # Format sources for prompt
        sources_text = "\n\n".join([
            f"Source {i+1} ({s['name']}):\n{s['content']}"
            for i, s in enumerate(sources)
        ])

        # Run multiple agents
        verifications = []
        from open_notebook.ai.models import Model
        model = await Model.get_default_model("outline")

        if not model:
            raise HTTPException(status_code=500, detail="No AI model available")

        esperanto_model = await model.get_esperanto_model()

        for agent_id in range(1, min(request.num_agents + 1, 6)):  # Max 5 agents
            try:
                prompt = VERIFICATION_PROMPT.format(
                    agent_id=agent_id,
                    claim=request.claim,
                    sources=sources_text,
                )

                response = await esperanto_model.ainvoke(prompt)
                response_text = response.content if hasattr(response, "content") else str(response)

                # Parse response
                cleaned = response_text.strip()
                if cleaned.startswith("```json"):
                    cleaned = cleaned[7:]
                if cleaned.startswith("```"):
                    cleaned = cleaned[3:]
                if cleaned.endswith("```"):
                    cleaned = cleaned[:-3]

                data = json.loads(cleaned.strip())

                verifications.append(AgentVerification(
                    agent_id=agent_id,
                    verdict=data.get("verdict", "inconclusive"),
                    confidence=float(data.get("confidence", 0.5)),
                    evidence=data.get("evidence", ""),
                    sources_used=data.get("sources_used", []),
                ))
            except (json.JSONDecodeError, Exception) as e:
                logger.warning(f"Agent {agent_id} failed: {e}")
                verifications.append(AgentVerification(
                    agent_id=agent_id,
                    verdict="inconclusive",
                    confidence=0.0,
                    evidence=f"Agent failed to produce valid response: {str(e)}",
                    sources_used=[],
                ))

        # Aggregate results
        verdicts = [v.verdict for v in verifications]
        confidences = [v.confidence for v in verifications]

        # Count verdicts
        supported = verdicts.count("supported")
        contradicted = verdicts.count("contradicted")
        inconclusive = verdicts.count("inconclusive")

        # Determine overall verdict
        if supported > contradicted and supported > inconclusive:
            overall_verdict = "supported"
        elif contradicted > supported and contradicted > inconclusive:
            overall_verdict = "contradicted"
        else:
            overall_verdict = "inconclusive"

        # Calculate average confidence
        avg_confidence = sum(confidences) / len(confidences) if confidences else 0.0

        # Find contradictions
        contradictions = []
        if contradicted > 0 and supported > 0:
            contradictions.append(f"Agent disagreement: {supported} supported, {contradicted} contradicted")

        # Build summary
        summary = f"Claim verification complete. {overall_verdict.upper()} with {avg_confidence:.0%} average confidence. "
        summary += f"{supported} agents supported, {contradicted} contradicted, {inconclusive} inconclusive."

        return VerifyResponse(
            claim=request.claim,
            overall_verdict=overall_verdict,
            confidence=round(avg_confidence, 2),
            agent_verifications=verifications,
            summary=summary,
            contradictions=contradictions,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error verifying claim: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))
