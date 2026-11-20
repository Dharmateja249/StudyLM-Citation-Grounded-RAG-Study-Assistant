"""
PDF Extraction Service with PyMuPDF, Relative Bounding Box Normalization,
and Gemini Vision OCR Fallback.
File: backend/app/services/pdf_service.py

Responsibilities:
- PyMuPDF extraction with asyncio thread offload to prevent GIL/heartbeat starvation.
- Relative bounding box normalization [x0, y0, x1, y1] clamped to [0.0, 1.0].
- Multiline sentence bounding box aggregation List[List[float]].
- Scanned page threshold detection (<50 chars).
- Gemini Vision OCR coordinate transformation [ymin, xmin, ymax, xmax] -> [x0, y0, x1, y1].
- Corrupted PDF exception handling (CorruptPDFError).
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

import fitz  # PyMuPDF

logger = logging.getLogger("studylm.pdf_service")

SCANNED_PAGE_CHAR_THRESHOLD = 50


class CorruptPDFError(Exception):
    """Raised when a PDF file cannot be parsed or opened."""
    def __init__(self, message: str = "Failed to parse PDF document: file appears corrupted or unreadable"):
        super().__init__(message)
        self.error_code = "ERR_CORRUPT_FILE"


@dataclass
class ExtractedWord:
    text: str
    x0: float
    y0: float
    x1: float
    y1: float
    block_no: int
    line_no: int
    word_no: int


@dataclass
class ExtractedPage:
    page_number: int  # 1-indexed
    text: str
    width: float
    height: float
    origin_x0: float = 0.0
    origin_y0: float = 0.0
    is_scanned: bool = False
    words: List[ExtractedWord] = field(default_factory=list)


def normalize_bbox(
    raw_x0: float,
    raw_y0: float,
    raw_x1: float,
    raw_y1: float,
    page_width: float,
    page_height: float,
    origin_x0: float = 0.0,
    origin_y0: float = 0.0,
) -> List[float]:
    """
    Normalizes PyMuPDF point coordinates to relative floats in [0.0, 1.0].
    Accounts for page rotation and CropBox offsets.
    """
    if page_width <= 0 or page_height <= 0:
        raise ValueError("Invalid page dimensions")

    x0 = max(0.0, min(1.0, round((raw_x0 - origin_x0) / page_width, 4)))
    y0 = max(0.0, min(1.0, round((raw_y0 - origin_y0) / page_height, 4)))
    x1 = max(0.0, min(1.0, round((raw_x1 - origin_x0) / page_width, 4)))
    y1 = max(0.0, min(1.0, round((raw_y1 - origin_y0) / page_height, 4)))

    if x0 > x1:
        x0, x1 = x1, x0
    if y0 > y1:
        y0, y1 = y1, y0

    return [x0, y0, x1, y1]


def convert_gemini_vision_bbox(
    ymin: int,
    xmin: int,
    ymax: int,
    xmax: int,
) -> List[float]:
    """
    Converts Gemini Vision OCR coordinates [ymin, xmin, ymax, xmax] in [0, 1000]
    to normalized relative floats [x0, y0, x1, y1] in [0.0, 1.0].
    """
    x0 = max(0.0, min(1.0, round(xmin / 1000.0, 4)))
    y0 = max(0.0, min(1.0, round(ymin / 1000.0, 4)))
    x1 = max(0.0, min(1.0, round(xmax / 1000.0, 4)))
    y1 = max(0.0, min(1.0, round(ymax / 1000.0, 4)))

    if x0 > x1:
        x0, x1 = x1, x0
    if y0 > y1:
        y0, y1 = y1, y0

    return [x0, y0, x1, y1]


def aggregate_multiline_bboxes(
    matched_words: List[ExtractedWord],
    page_width: float,
    page_height: float,
    origin_x0: float = 0.0,
    origin_y0: float = 0.0,
) -> List[List[float]]:
    """
    Aggregates a sequence of words into distinct bounding boxes per visual line.
    Returns List[List[float]] where each element is [x0, y0, x1, y1].
    """
    if not matched_words:
        return []

    # Group words by visual line (block_no, line_no)
    lines_map: Dict[Tuple[int, int], List[ExtractedWord]] = {}
    line_order: List[Tuple[int, int]] = []

    for w in matched_words:
        key = (w.block_no, w.line_no)
        if key not in lines_map:
            lines_map[key] = []
            line_order.append(key)
        lines_map[key].append(w)

    bboxes: List[List[float]] = []
    for key in line_order:
        words_on_line = lines_map[key]
        raw_x0 = min(w.x0 for w in words_on_line)
        raw_y0 = min(w.y0 for w in words_on_line)
        raw_x1 = max(w.x1 for w in words_on_line)
        raw_y1 = max(w.y1 for w in words_on_line)

        norm_box = normalize_bbox(
            raw_x0=raw_x0,
            raw_y0=raw_y0,
            raw_x1=raw_x1,
            raw_y1=raw_y1,
            page_width=page_width,
            page_height=page_height,
            origin_x0=origin_x0,
            origin_y0=origin_y0,
        )
        bboxes.append(norm_box)

    return bboxes


def extract_pdf_pages_sync(pdf_bytes: bytes) -> List[ExtractedPage]:
    """
    Synchronous pure extraction routine suitable for thread/process execution.
    """
    if not pdf_bytes:
        raise CorruptPDFError("PDF bytes are empty")

    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    except Exception as exc:
        raise CorruptPDFError(f"Failed to open PDF document: {exc}") from exc

    try:
        if doc.is_encrypted:
            raise CorruptPDFError("PDF document is encrypted")

        if doc.page_count == 0:
            raise CorruptPDFError("PDF document contains 0 pages")

        pages: List[ExtractedPage] = []

        for page_idx in range(doc.page_count):
            page = doc[page_idx]
            rect = page.rect  # Rotation and crop adjusted
            page_width = rect.width
            page_height = rect.height
            origin_x0 = rect.x0
            origin_y0 = rect.y0

            raw_words = page.get_text("words")  # (x0, y0, x1, y1, text, block, line, word)
            extracted_words: List[ExtractedWord] = []
            rot_mat = page.rotation_matrix if hasattr(page, "rotation_matrix") else None

            for w in raw_words:
                if page.rotation != 0 and rot_mat:
                    r = fitz.Rect(w[0], w[1], w[2], w[3]) * rot_mat
                    wx0, wy0, wx1, wy1 = r.x0, r.y0, r.x1, r.y1
                else:
                    wx0, wy0, wx1, wy1 = w[0], w[1], w[2], w[3]

                extracted_words.append(
                    ExtractedWord(
                        x0=wx0,
                        y0=wy0,
                        x1=wx1,
                        y1=wy1,
                        text=w[4],
                        block_no=w[5],
                        line_no=w[6],
                        word_no=w[7],
                    )
                )


            full_text = page.get_text("text").strip()
            is_scanned = len(full_text) < SCANNED_PAGE_CHAR_THRESHOLD

            pages.append(
                ExtractedPage(
                    page_number=page_idx + 1,
                    text=full_text,
                    width=page_width,
                    height=page_height,
                    origin_x0=origin_x0,
                    origin_y0=origin_y0,
                    is_scanned=is_scanned,
                    words=extracted_words,
                )
            )

        return pages
    finally:
        doc.close()


async def extract_pdf_pages(pdf_bytes: bytes) -> List[ExtractedPage]:
    """
    Async wrapper executing PDF parsing in thread pool to protect event loop.
    """
    return await asyncio.to_thread(extract_pdf_pages_sync, pdf_bytes)
