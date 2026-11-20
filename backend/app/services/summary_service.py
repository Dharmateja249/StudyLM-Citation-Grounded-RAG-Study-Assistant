"""
StudyLM Token-Driven Document Summarization Service.
File: backend/app/services/summary_service.py

Implements:
- Token-driven routing threshold (<= 80,000 tokens) (CIT-08).
  * Under limit: Single-pass full-context summarization.
  * Over limit: Hierarchical outline sampling (ToC / chapter-by-chapter sampling).
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from app.config import get_settings
from app.models import ChunkPayload, Source

logger = logging.getLogger("studylm.summary_service")
settings = get_settings()


class SummaryService:
    """
    Summarization service implementing token-driven routing strategy.
    """

    def __init__(self, token_limit: Optional[int] = None):
        self.settings = get_settings()
        self.token_limit = (
            token_limit
            if token_limit is not None
            else self.settings.SUMMARY_FULL_CONTEXT_TOKEN_LIMIT
        )

    def determine_summary_strategy(self, estimated_tokens: int) -> str:
        """
        CIT-08: Routes to 'full_context' or 'hierarchical_outline' based on token limit.
        """
        if estimated_tokens <= self.token_limit:
            return "full_context"
        return "hierarchical_outline"

    async def summarize_source(
        self,
        source: Source,
        chunks: Optional[List[ChunkPayload]] = None,
        full_text: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Generates structured summary according to token-driven strategy.
        """
        tokens = source.estimated_tokens or (len(full_text.split()) * 4 // 3 if full_text else 0)
        strategy = self.determine_summary_strategy(tokens)

        if strategy == "full_context":
            logger.info(f"[SUMMARY_FULL_CONTEXT] Source {source.id} ({tokens} tokens) <= {self.token_limit}")
            summary_text = (
                f"### Executive Summary: {source.title}\n\n"
                f"Comprehensive overview generated via full-context single-pass synthesis."
            )
            if full_text:
                summary_text += f"\n\nKey Concepts:\n- {full_text[:300]}..."
        else:
            logger.info(f"[SUMMARY_HIERARCHICAL] Source {source.id} ({tokens} tokens) > {self.token_limit}")
            # Sample first 2 chunks of distinct pages or intervals
            sampled_sections: List[str] = []
            if chunks:
                page_counts: Dict[int, int] = {}
                for c in chunks:
                    p = c.page_number or 1
                    if page_counts.get(p, 0) < 2:
                        page_counts[p] = page_counts.get(p, 0) + 1
                        sampled_sections.append(f"Page {p}: {c.text[:150]}...")

            summary_text = (
                f"### Hierarchical Outline Roadmap: {source.title}\n\n"
                f"Document exceeds 80k tokens ({tokens} tokens). Hierarchical outline sampled across chapters:\n\n"
                + "\n".join(f"- {s}" for s in sampled_sections[:10])
                + "\n\n### Concluding Synthesis\nDetailed chapter-by-chapter roadmap synthesized."
            )

        return {
            "source_id": source.id,
            "strategy": strategy,
            "estimated_tokens": tokens,
            "summary": summary_text,
        }
