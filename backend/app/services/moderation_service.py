"""
StudyLM Educational Moderation & Relevance Barrier Service.
File: backend/app/services/moderation_service.py

Implements:
- R3 / ING-19 Two-Tier Educational Content Barrier:
  - Tier 1: Fast keyword & metadata heuristics scanning title, description, tags.
  - Tier 2: Fast Gemini LLM classifier prompt returning structured EducationalCheckResult.
- Strict non-educational rejection contract:
  - Halts ingestion before transcription/chunking/embedding.
  - Complete suppression of title and content.
  - Sets exact error_code="ERR_NON_EDUCATIONAL_CONTENT" and
    error_message="Upload educational related video, this video does not have educational content please recheck the link".
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Dict, List, Optional

from app.config import get_settings
from app.models import EducationalCheckResult

logger = logging.getLogger("studylm.moderation_service")


class EducationalModerationService:
    """Production two-tier content moderation barrier for educational relevance."""

    def __init__(self, gemini_client: Optional[Any] = None):
        self.settings = get_settings()
        if gemini_client is None and self.settings.GEMINI_API_KEY and not self.settings.GEMINI_API_KEY.startswith("mock-") and self.settings.ENVIRONMENT != "testing":
            try:
                from google import genai
                gemini_client = genai.Client(api_key=self.settings.GEMINI_API_KEY)
            except Exception as e:
                logger.warning(f"Could not initialize default Gemini client for EducationalModerationService: {e}")
        self.gemini_client = gemini_client

    def evaluate_tier1_heuristics(
        self,
        title: str,
        description: str = "",
        tags: Optional[List[str]] = None,
    ) -> Optional[EducationalCheckResult]:
        """
        Tier 1: Fast zero-cost keyword and metadata heuristics.
        Returns EducationalCheckResult if decisive, or None if ambiguous (escalate to Tier 2).
        """
        combined = f"{title} {description} {' '.join(tags or [])}".lower()

        # Check negative entertainment/music flags
        matched_negatives = [
            flag for flag in self.settings.NON_EDUCATIONAL_NEGATIVE_FLAGS
            if re.search(r"\b" + re.escape(flag.lower()) + r"\b", combined)
        ]

        # Check positive educational anchor keywords
        matched_positives = [
            kw for kw in self.settings.EDUCATIONAL_KEYWORDS
            if re.search(r"\b" + re.escape(kw.lower()) + r"\b", combined)
        ]

        # Strong Negative Rejection: Matched negative entertainment flags and no positive keywords
        if matched_negatives and len(matched_positives) == 0:
            logger.info(f"[TIER1_REJECT] Matched negative flags: {matched_negatives}")
            return EducationalCheckResult(
                is_educational=False,
                confidence=0.95,
                reason=f"Matched non-educational entertainment indicators: {matched_negatives[:2]}",
            )

        # Strong Educational Approval: Matched >=2 distinct educational keywords and 0 negative flags
        if len(matched_positives) >= 2 and not matched_negatives:
            logger.info(f"[TIER1_APPROVE] Matched educational keywords: {matched_positives}")
            return EducationalCheckResult(
                is_educational=True,
                confidence=0.95,
                reason=f"Matched academic/educational indicators: {matched_positives[:3]}",
            )

        # Ambiguous: Return None to escalate to Tier 2 LLM classifier
        return None

    async def evaluate_tier2_llm_classifier(
        self,
        title: str,
        description: str = "",
        tags: Optional[List[str]] = None,
    ) -> EducationalCheckResult:
        """
        Tier 2: Fast Gemini LLM zero-shot classifier for ambiguous content.
        """
        snippet_desc = (description or "")[:1000]
        prompt = (
            "You are an educational content verification classifier for StudyLM.\n"
            "Analyze whether this YouTube video is educational/academic material "
            "(lectures, tutorials, academic courses, scientific explanations, educational documentaries, technical discussions) "
            "or non-educational content (entertainment, gaming, vlogs, music videos, comedic sketches, gossip, unboxings, advertisements).\n\n"
            f"Title: {title}\n"
            f"Description: {snippet_desc}\n"
            f"Tags: {', '.join(tags or [])}\n\n"
            "Respond strictly with valid JSON conforming to:\n"
            '{"is_educational": bool, "confidence": float, "reason": str}'
        )

        if self.gemini_client is None:
            # Offline / default heuristic fallback
            combined = f"{title} {snippet_desc}".lower()
            is_edu = any(kw in combined for kw in self.settings.EDUCATIONAL_KEYWORDS)
            has_neg = any(fl in combined for fl in self.settings.NON_EDUCATIONAL_NEGATIVE_FLAGS)
            verdict = is_edu and not has_neg
            return EducationalCheckResult(
                is_educational=verdict,
                confidence=0.85,
                reason="Evaluated by default offline fallback classifier",
            )

        models_to_try = [self.settings.GEMINI_GENERATION_MODEL, "gemini-2.5-flash", "gemini-3.7-flash"]
        for model_name in models_to_try:
            try:
                response = await self.gemini_client.aio.models.generate_content(
                    model=model_name,
                    contents=prompt,
                )
                raw_text = response.text.strip()
                # Clean possible markdown formatting
                if raw_text.startswith("```"):
                    lines = raw_text.splitlines()
                    if lines[0].startswith("```"):
                        lines = lines[1:]
                    if lines and lines[-1].startswith("```"):
                        lines = lines[:-1]
                    raw_text = "\n".join(lines).strip()
                data = json.loads(raw_text)
                return EducationalCheckResult(
                    is_educational=bool(data.get("is_educational", False)),
                    confidence=float(data.get("confidence", 0.5)),
                    reason=str(data.get("reason", "LLM classifier evaluation")),
                )
            except Exception as exc:
                logger.warning(
                    f"[TIER2_ERROR] LLM evaluation with {model_name} encountered error: {exc}"
                )
                continue

        # If LLM evaluation failed or raised exception
        logger.warning(
            f"[TIER2_ERROR] LLM evaluation encountered error; conservative reject"
        )
        return EducationalCheckResult(
            is_educational=False,
            confidence=0.60,
            reason="LLM classifier evaluation failed",
        )

    async def check_educational_relevance(
        self,
        title: str,
        description: str = "",
        tags: Optional[List[str]] = None,
    ) -> EducationalCheckResult:
        """
        Runs the full Two-Tier Educational Content Barrier pipeline.
        """
        if not self.settings.EDUCATIONAL_BARRIER_ENABLED:
            return EducationalCheckResult(
                is_educational=True,
                confidence=1.0,
                reason="Educational barrier disabled by config",
            )

        # Tier 1 Heuristics
        tier1_result = self.evaluate_tier1_heuristics(title, description, tags)
        if tier1_result is not None:
            return tier1_result

        # Tier 2 LLM Classifier
        return await self.evaluate_tier2_llm_classifier(title, description, tags)


# Global singleton helper
_moderation_service_instance: Optional[EducationalModerationService] = None


def get_moderation_service(gemini_client: Optional[Any] = None) -> EducationalModerationService:
    global _moderation_service_instance
    if _moderation_service_instance is None or gemini_client is not None:
        _moderation_service_instance = EducationalModerationService(gemini_client=gemini_client)
    return _moderation_service_instance
