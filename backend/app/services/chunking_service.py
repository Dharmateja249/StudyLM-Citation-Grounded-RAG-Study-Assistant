"""
Document Chunking Service with Multiline Bullet Pre-Splitting,
pysbd Sentence Segmentation, Deterministic IDs, and Zero Page Bleed.
File: backend/app/services/chunking_service.py

Responsibilities:
- Regex-anchored multiline bullet pre-splitting: (?m)^(\s*)([•*]|\d+\.|-)\s+
- pysbd sentence disambiguation preserving abbreviations (Dr., Fig., i.e.)
- 400 token target chunk sizing with 50 token sentence overlap
- Deterministic chunk IDs: {source_id}_p{page:04d}_c{idx:03d}
- Deterministic Qdrant point IDs: uuid5(NAMESPACE_DNS, f"{ingest_run_id}:{chunk_id}")
- Zero page bleed enforcement (page-boundary truncation)
"""

from __future__ import annotations

import logging
import re
import uuid
from typing import Any, List, Optional, Tuple

import pysbd

from app.models import ChunkPayload, SentenceSpan
from app.services.pdf_service import ExtractedPage, ExtractedWord, aggregate_multiline_bboxes

logger = logging.getLogger("studylm.chunking_service")

BULLET_PATTERN = re.compile(r"(?m)^(\s*)([•*]|\d+\.|-)\s+")
TARGET_CHUNK_TOKENS = 400
CHUNK_OVERLAP_TOKENS = 50


def count_tokens(text: str) -> int:
    """
    Subword token estimator for chunk sizing.
    Uses whitespace word count scaled by 1.33 subword ratio.
    """
    if not text:
        return 0
    words = text.split()
    return max(1, int(len(words) * 1.33))


def segment_sentences_with_bullets(text: str) -> List[str]:
    """
    Segments text into sentences honoring multiline bullet pre-splitting
    and pysbd sentence disambiguation.
    Bullets matching (?m)^(\s*)([•*]|\d+\.|-)\s+ are separated into distinct segments.
    """
    if not text or not text.strip():
        return []

    lines = text.splitlines(keepends=True)
    segments: List[str] = []
    current_segment: List[str] = []

    for line in lines:
        if BULLET_PATTERN.match(line):
            if current_segment:
                segments.append("".join(current_segment))
                current_segment = []
        current_segment.append(line)

    if current_segment:
        segments.append("".join(current_segment))

    segmenter = pysbd.Segmenter(language="en", clean=False)
    results: List[str] = []

    for seg in segments:
        seg_str = seg.strip()
        if not seg_str:
            continue
        # Normalize soft linebreaks (intra-paragraph newlines from PDF wrapping) into spaces
        # so multiline sentences remain intact for pysbd segmentation
        normalized_seg = re.sub(r"(?<!\n)\n(?!\n)", " ", seg_str)
        pysbd_sents = segmenter.segment(normalized_seg)
        if isinstance(pysbd_sents, list):
            for s in pysbd_sents:
                clean_s = s.strip()
                if clean_s:
                    results.append(clean_s)
        else:
            clean_s = str(pysbd_sents).strip()
            if clean_s:
                results.append(clean_s)

    return results


def match_sentence_to_words(
    sentence_text: str,
    page: ExtractedPage,
    start_word_idx: int = 0,
) -> Tuple[List[ExtractedWord], int]:
    """
    Finds consecutive words on the page matching the sentence text.
    Returns (matched_words, next_word_idx).
    """
    sentence_words = sentence_text.split()
    if not sentence_words or not page.words:
        return [], start_word_idx

    matched: List[ExtractedWord] = []
    target_idx = 0
    curr_idx = start_word_idx

    while curr_idx < len(page.words) and target_idx < len(sentence_words):
        w = page.words[curr_idx]
        target_w = sentence_words[target_idx]
        clean_w = re.sub(r"[^\w]", "", w.text.lower())
        clean_target = re.sub(r"[^\w]", "", target_w.lower())

        if clean_w == clean_target or (clean_w and clean_target and (clean_w in clean_target or clean_target in clean_w)):
            matched.append(w)
            target_idx += 1
        elif matched:
            # Continue scanning contiguous matched block
            matched.append(w)
        curr_idx += 1

    return matched, curr_idx


def build_page_sentence_spans(page: ExtractedPage) -> List[SentenceSpan]:
    """
    Segments page text into SentenceSpans with multiline bounding boxes.
    """
    raw_sentences = segment_sentences_with_bullets(page.text)
    spans: List[SentenceSpan] = []
    word_cursor = 0

    for idx, s_text in enumerate(raw_sentences):
        matched_words, word_cursor = match_sentence_to_words(
            sentence_text=s_text,
            page=page,
            start_word_idx=word_cursor,
        )
        bboxes = aggregate_multiline_bboxes(
            matched_words=matched_words,
            page_width=page.width,
            page_height=page.height,
            origin_x0=page.origin_x0,
            origin_y0=page.origin_y0,
        )
        spans.append(
            SentenceSpan(
                sentence_id=f"s{idx}",
                text=s_text,
                bboxes=bboxes,
            )
        )

    return spans


def chunk_page_sentences(
    page: ExtractedPage,
    source_id: str,
    notebook_id: str,
    user_id: str,
    ingest_run_id: str,
    ingested_at: int,
    embedding_model: str,
    source_title: str,
    start_chunk_idx: int = 0,
) -> List[ChunkPayload]:
    """
    Assembles SentenceSpans for a single page into 400-token chunks
    with 50-token overlap, strictly zero page bleed.
    """
    sentence_spans = build_page_sentence_spans(page)
    if not sentence_spans:
        return []

    chunks: List[ChunkPayload] = []
    current_sentences: List[SentenceSpan] = []
    current_tokens = 0
    chunk_idx = start_chunk_idx

    for span in sentence_spans:
        span_tokens = count_tokens(span.text)
        candidate_words = sum(len(s.text.split()) for s in current_sentences) + len(span.text.split())
        candidate_tokens = max(1, int(candidate_words * 1.33))

        if current_sentences and (candidate_tokens > TARGET_CHUNK_TOKENS or current_tokens + span_tokens > TARGET_CHUNK_TOKENS):
            # Finalize current chunk
            chunk_text = " ".join(s.text for s in current_sentences)
            chunk_id = f"{source_id}_p{page.page_number:04d}_c{chunk_idx:03d}"
            chunks.append(
                ChunkPayload(
                    chunk_id=chunk_id,
                    source_id=source_id,
                    notebook_id=notebook_id,
                    user_id=user_id,
                    ingest_run_id=ingest_run_id,
                    ingested_at=ingested_at,
                    embedding_model=embedding_model,
                    source_title=source_title,
                    source_type="pdf",
                    page_number=page.page_number,
                    text=chunk_text,
                    sentences=list(current_sentences),
                )
            )
            chunk_idx += 1

            # Prepare overlap
            overlap_sentences: List[SentenceSpan] = []
            overlap_tokens = 0
            for s in reversed(current_sentences):
                s_tok = count_tokens(s.text)
                if overlap_tokens + s_tok <= CHUNK_OVERLAP_TOKENS:
                    overlap_sentences.insert(0, s)
                    overlap_tokens += s_tok
                else:
                    break

            current_sentences = list(overlap_sentences)
            current_tokens = overlap_tokens

        current_sentences.append(span)
        current_tokens = max(1, int(sum(len(s.text.split()) for s in current_sentences) * 1.33))

    # Finalize remaining sentences
    if current_sentences:
        chunk_text = " ".join(s.text for s in current_sentences)
        chunk_id = f"{source_id}_p{page.page_number:04d}_c{chunk_idx:03d}"
        chunks.append(
            ChunkPayload(
                chunk_id=chunk_id,
                source_id=source_id,
                notebook_id=notebook_id,
                user_id=user_id,
                ingest_run_id=ingest_run_id,
                ingested_at=ingested_at,
                embedding_model=embedding_model,
                source_title=source_title,
                source_type="pdf",
                page_number=page.page_number,
                text=chunk_text,
                sentences=list(current_sentences),
            )
        )

    return chunks


def chunk_document_pages(
    pages: List[ExtractedPage],
    source_id: str,
    notebook_id: str,
    user_id: str,
    ingest_run_id: str,
    ingested_at: int,
    embedding_model: str,
    source_title: str,
) -> List[ChunkPayload]:
    """
    Chunks all pages of a document strictly per-page (zero page bleed).
    Sentences never cross physical page boundaries.
    """
    all_chunks: List[ChunkPayload] = []
    chunk_idx = 0
    for page in pages:
        page_chunks = chunk_page_sentences(
            page=page,
            source_id=source_id,
            notebook_id=notebook_id,
            user_id=user_id,
            ingest_run_id=ingest_run_id,
            ingested_at=ingested_at,
            embedding_model=embedding_model,
            source_title=source_title,
            start_chunk_idx=chunk_idx,
        )
        all_chunks.extend(page_chunks)
        chunk_idx += len(page_chunks)
    return all_chunks


def generate_qdrant_point_id(ingest_run_id: str, chunk_id: str) -> str:
    """
    Generates deterministic UUIDv5 in DNS namespace for Qdrant point.
    Formula: uuid5(NAMESPACE_DNS, f"{ingest_run_id}:{chunk_id}")
    """
    return str(uuid.uuid5(uuid.NAMESPACE_DNS, f"{ingest_run_id}:{chunk_id}"))
