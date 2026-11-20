"""
StudyLM Authoritative Citation Resolution & Streaming Validation Service.
File: backend/app/services/citation_service.py

Implements:
- Inline custom token citation resolution [[cite:1]], [[cite:C1#s0]] (CIT-01).
- Anti-hallucination stripping: strips invalid / ungrounded markers cleanly (CIT-02).
- Metadata extraction strictly from Qdrant stored payload truth (CIT-03).
- Sentence-buffered SSE streaming validator preventing invalid markers escaping (CIT-11).
"""

from __future__ import annotations

import logging
import re
from typing import Any, AsyncGenerator, Dict, List, Optional, Set, Tuple

from app.models import ChunkPayload, ResolvedCitation, SentenceSpan

logger = logging.getLogger("studylm.citation_service")


class CitationService:
    """
    Authoritative citation resolution engine.
    Maps inline citation markers to verified ground-truth payloads stored in Qdrant.
    """

    # Regex matching [[cite:1]], [[cite:C1#s0]], [cite: C1], [cite: C1, C3], etc.
    CITATION_REGEX = re.compile(r"\[{1,2}cite:\s*([a-zA-Z0-9_#,\s]+)\]{1,2}")

    def build_citation_map(
        self,
        retrieved_chunks: List[Dict[str, Any]],
    ) -> Dict[str, Dict[str, Any]]:
        """
        Builds a lookup map from chunk aliases (C1, C2) and sentence IDs (s0, s1)
        to verified ground truth payload data.
        """
        lookup: Dict[str, Dict[str, Any]] = {}

        for idx, chunk_data in enumerate(retrieved_chunks, 1):
            alias = f"C{idx}"
            chunk_id = chunk_data.get("chunk_id", f"c_{idx}")
            source_id = chunk_data.get("source_id", "")
            source_title = chunk_data.get("source_title", "Untitled Source")
            source_type = chunk_data.get("source_type", "pdf")
            page_number = chunk_data.get("page_number")
            start_seconds = chunk_data.get("start_seconds")

            # Extract sentences
            raw_sentences = chunk_data.get("sentences", [])
            sentences: List[SentenceSpan] = []
            for s in raw_sentences:
                if isinstance(s, dict):
                    sentences.append(SentenceSpan(**s))
                elif isinstance(s, SentenceSpan):
                    sentences.append(s)

            # Build deep link
            if source_type == "youtube":
                deep_link = f"https://youtube.com/watch?v={source_id}&t={start_seconds or 0}s"
            else:
                deep_link = f"/sources/{source_id}/view#page={page_number or 1}"

            # Store chunk-level fallback entry
            first_quote = sentences[0].text if sentences else chunk_data.get("text", "")[:100]
            first_bboxes = sentences[0].bboxes if sentences else []

            chunk_info = {
                "source_id": source_id,
                "source_title": source_title,
                "source_type": source_type,
                "page_number": page_number,
                "bboxes": first_bboxes,
                "start_seconds": start_seconds,
                "deep_link": deep_link,
                "quote": first_quote,
                "alias": alias,
                "chunk_id": chunk_id,
            }

            lookup[alias] = chunk_info
            lookup[str(idx)] = chunk_info  # allow numeric index [[cite:1]]

            # Map specific sentences: "C1#s0" and "s0"
            for s_idx, sent in enumerate(sentences):
                sent_key = f"{alias}#{sent.sentence_id}"
                sent_link = deep_link
                if source_type == "youtube" and sent.start_seconds is not None:
                    sent_link = f"https://youtube.com/watch?v={source_id}&t={int(sent.start_seconds)}s"

                sent_info = {
                    "source_id": source_id,
                    "source_title": source_title,
                    "source_type": source_type,
                    "page_number": page_number,
                    "bboxes": sent.bboxes,
                    "start_seconds": sent.start_seconds or start_seconds,
                    "deep_link": sent_link,
                    "quote": sent.text,
                    "alias": alias,
                    "sentence_id": sent.sentence_id,
                    "chunk_id": chunk_id,
                }
                lookup[sent_key] = sent_info
                # Also allow direct sentence id if unique
                if sent.sentence_id not in lookup:
                    lookup[sent.sentence_id] = sent_info

        return lookup

    def resolve_citations(
        self,
        text: str,
        retrieved_chunks: List[Dict[str, Any]],
        resolved_marker_map: Optional[Dict[str, int]] = None,
        counter_state: Optional[List[int]] = None,
    ) -> Tuple[str, List[ResolvedCitation]]:
        """
        CIT-01, CIT-02, CIT-03:
        Resolves inline citation markers against stored Qdrant payload truth.
        - Valid markers are numbered sequentially: [[cite:1]], [[cite:2]], ...
        - Invalid / hallucinated markers are stripped cleanly from the answer text.
        - Accepts stateful resolved_marker_map and counter_state for multi-sentence streams.
        """
        lookup = self.build_citation_map(retrieved_chunks)
        resolved: List[ResolvedCitation] = []
        if resolved_marker_map is None:
            resolved_marker_map = {}
        if counter_state is None:
            counter_state = [1]

        def replace_marker(match: re.Match) -> str:
            raw_content = match.group(1).strip()
            # Split comma-separated citations if present, e.g. "C1, C3"
            keys = [k.strip() for k in raw_content.split(",") if k.strip()]

            replacement_tokens = []
            for raw_key in keys:
                if raw_key in lookup:
                    data = lookup[raw_key]
                    # Disambiguate by source_id, page_number, start_seconds, and quote
                    canonical_key = (
                        f"{data['source_id']}_{data.get('page_number')}_"
                        f"{data.get('start_seconds')}_{data.get('quote')}"
                    )

                    if canonical_key in resolved_marker_map:
                        m_id = resolved_marker_map[canonical_key]
                    else:
                        m_id = counter_state[0]
                        counter_state[0] += 1
                        resolved_marker_map[canonical_key] = m_id
                        resolved.append(
                            ResolvedCitation(
                                marker_id=m_id,
                                source_id=data["source_id"],
                                source_title=data["source_title"],
                                source_type=data["source_type"],
                                page_number=data["page_number"],
                                bboxes=data["bboxes"],
                                start_seconds=data["start_seconds"],
                                deep_link=data["deep_link"],
                                quote=data["quote"],
                            )
                        )
                    replacement_tokens.append(f"[[cite:{m_id}]]")
                else:
                    # Hallucinated or non-existent marker: strip cleanly (CIT-02)
                    logger.warning(f"[STRIP_HALLUCINATED_CITE] Stripping ungrounded marker: {raw_key}")

            return " ".join(replacement_tokens)

        # Replace valid markers with normalized sequential [[cite:N]] and strip hallucinated
        cleaned_text = self.CITATION_REGEX.sub(replace_marker, text)
        # Ensure citations placed before sentence-ending periods are placed after the period:
        # e.g. "grid [[cite:1]]." -> "grid. [[cite:1]]" (prevents orphaned line-wrapped punctuation)
        cleaned_text = re.sub(r"\s*((?:\[\[cite:\d+\]\]\s*)+)\.", r". \1", cleaned_text)
        # Fix spacing between citation tag and following word or punctuation
        cleaned_text = re.sub(r"(\]\])([A-Za-z])", r"\1 \2", cleaned_text)
        cleaned_text = re.sub(r"(\]\]\.)([A-Za-z])", r"\1 \2", cleaned_text)
        cleaned_text = re.sub(r"(\]\]\.?)(\d+\.)", r"\1 \2", cleaned_text)
        # Ensure punctuation followed directly by an uppercase letter has a space: e.g. ".It" -> ". It"
        cleaned_text = re.sub(r"([.!?])([A-Z])", r"\1 \2", cleaned_text)
        # Ensure numbered list items have space: e.g. "1.Spark" -> "1. Spark"
        cleaned_text = re.sub(r"(\d+\.)([A-Za-z])", r"\1 \2", cleaned_text)
        # Ensure headings have double newline before them: e.g. "title:### Heading" -> "title:\n\n### Heading"
        cleaned_text = re.sub(r"([^\n#])(\#{1,6}\s*)", r"\1\n\n\2", cleaned_text)
        # Ensure bullet points glued to periods are placed on new line: e.g. ".[cite: C1].* Speed" -> ".\n* Speed"
        cleaned_text = re.sub(r"(\.)\s*(\*)", r"\1\n\2", cleaned_text)
        # Clean up any leftover double spaces from stripped citations
        cleaned_text = re.sub(r" +", " ", cleaned_text).strip()

        return cleaned_text, resolved


class StreamingSentenceBuffer:
    """
    CIT-11: Sentence-level token buffer for SSE streaming validation.
    Buffers incoming LLM token chunks, detects complete sentences, validates
    citation markers before emitting events, preventing hallucinated markers from escaping.
    """

    def __init__(self, citation_service: CitationService, retrieved_chunks: List[Dict[str, Any]]):
        self.citation_service = citation_service
        self.retrieved_chunks = retrieved_chunks
        self.buffer = ""
        self.emitted_citations: List[ResolvedCitation] = []
        self.resolved_marker_map: Dict[str, int] = {}
        self.counter_state: List[int] = [1]
        self.sentence_end_pattern = re.compile(r"([.!?\n]+(?:\s+|$))")

    async def process_token_stream(
        self,
        token_stream: AsyncGenerator[str, None],
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Yields validated sentence chunks as they complete in the stream.
        """
        is_first_chunk = True
        async for token in token_stream:
            self.buffer += token
            # Check for sentence boundaries
            while True:
                match = self.sentence_end_pattern.search(self.buffer)
                if not match:
                    break

                split_point = match.end()
                sentence_raw = self.buffer[:split_point]

                # Ensure we do not split prematurely across an unclosed citation bracket: e.g. "[[cite:C1"
                last_open = sentence_raw.rfind("[")
                last_close = sentence_raw.rfind("]")
                if last_open != -1 and last_open > last_close:
                    break

                self.buffer = self.buffer[split_point:]

                # Strip robotic introductory boilerplate on first chunk
                if is_first_chunk:
                    sentence_raw = re.sub(
                        r"^(?:based\s+on\s+(?:the\s+)?(?:provided\s+|uploaded\s+)?(?:sources|notes|materials|documents)[^:\n]*[:\n-]*\s*)",
                        "",
                        sentence_raw,
                        flags=re.IGNORECASE,
                    )
                    sentence_raw = re.sub(
                        r"^(?:according\s+to\s+(?:the\s+)?(?:provided\s+|uploaded\s+)?(?:sources|notes|materials|documents)[^:\n]*[:\n-]*\s*)",
                        "",
                        sentence_raw,
                        flags=re.IGNORECASE,
                    )
                    is_first_chunk = False

                # Preserve trailing whitespace (such as space or newline) from sentence_raw
                trailing_ws_match = re.search(r"(\s+)$", sentence_raw)
                trailing_ws = trailing_ws_match.group(1) if trailing_ws_match else " "

                # Resolve & validate citations in completed sentence using persistent stream mapping
                cleaned_sentence, new_cites = self.citation_service.resolve_citations(
                    sentence_raw,
                    self.retrieved_chunks,
                    resolved_marker_map=self.resolved_marker_map,
                    counter_state=self.counter_state,
                )
                self.emitted_citations.extend(new_cites)

                if cleaned_sentence.strip():
                    # Re-attach trailing space so consecutive streamed sentences don't merge without spaces
                    formatted_chunk = cleaned_sentence.rstrip() + trailing_ws
                    yield {
                        "type": "content",
                        "text": formatted_chunk,
                        "citations": [c.model_dump() for c in new_cites],
                    }

        # Flush remaining buffer at stream end
        if self.buffer.strip():
            remaining = self.buffer
            if is_first_chunk:
                remaining = re.sub(
                    r"^(?:based\s+on\s+(?:the\s+)?(?:provided\s+|uploaded\s+)?(?:sources|notes|materials|documents)[^:\n]*[:\n-]*\s*)",
                    "",
                    remaining,
                    flags=re.IGNORECASE,
                )
                remaining = re.sub(
                    r"^(?:according\s+to\s+(?:the\s+)?(?:provided\s+|uploaded\s+)?(?:sources|notes|materials|documents)[^:\n]*[:\n-]*\s*)",
                    "",
                    remaining,
                    flags=re.IGNORECASE,
                )
            cleaned_sentence, final_cites = self.citation_service.resolve_citations(
                remaining,
                self.retrieved_chunks,
                resolved_marker_map=self.resolved_marker_map,
                counter_state=self.counter_state,
            )
            self.emitted_citations.extend(final_cites)
            if cleaned_sentence:
                yield {
                    "type": "content",
                    "text": cleaned_sentence,
                    "citations": [c.model_dump() for c in final_cites],
                }

        # Final end-of-stream event
        yield {
            "type": "done",
            "total_citations": len(self.emitted_citations),
        }


# Global instance
_citation_service: Optional[CitationService] = None


def get_citation_service() -> CitationService:
    global _citation_service
    if _citation_service is None:
        _citation_service = CitationService()
    return _citation_service
