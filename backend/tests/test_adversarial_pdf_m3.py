"""
Milestone 3 Adversarial Test Harness: PDF Extraction, Geometry, Chunking, and OCR.
File: backend/tests/test_adversarial_pdf_m3.py

Tests:
1. Rotated pages (0°, 90°, 180°, 270°) and custom cropboxes (assert coordinates [0.0, 1.0]).
2. Multiline sentence bounding boxes (tight line-by-line bounding boxes in List[List[float]]).
3. Sentence segmentation and bullet pre-splitting against decimals, hyphens, abbreviations, and edge patterns.
4. Scanned page classification (<50 chars boundary) and Gemini Vision OCR coordinate transformation.
5. Zero page bleeding across physical page boundaries.
6. Corrupted, truncated, zero-page, and password-protected PDF handling.
"""

import io
import re
import pytest
import fitz  # PyMuPDF

from app.models import ChunkPayload, SentenceSpan
from app.services.pdf_service import (
    CorruptPDFError,
    ExtractedPage,
    ExtractedWord,
    SCANNED_PAGE_CHAR_THRESHOLD,
    aggregate_multiline_bboxes,
    convert_gemini_vision_bbox,
    extract_pdf_pages_sync,
    normalize_bbox,
)
from app.services.chunking_service import (
    BULLET_PATTERN,
    build_page_sentence_spans,
    chunk_document_pages,
    chunk_page_sentences,
    count_tokens,
    generate_qdrant_point_id,
    match_sentence_to_words,
    segment_sentences_with_bullets,
)


def create_pdf(
    pages_data: list[dict],
) -> bytes:
    """
    Creates a synthetic PDF with customizable properties:
    pages_data: list of dicts with:
      - 'text': str
      - 'rect': fitz.Rect (optional, default 612x792)
      - 'cropbox': fitz.Rect (optional)
      - 'rotation': int (0, 90, 180, 270)
      - 'lines': list of (Point, str)
    """
    doc = fitz.open()
    for p_info in pages_data:
        width = p_info.get("width", 612)
        height = p_info.get("height", 792)
        page = doc.new_page(width=width, height=height)

        rotation = p_info.get("rotation", 0)
        if rotation:
            page.set_rotation(rotation)

        cropbox = p_info.get("cropbox")
        if cropbox:
            page.set_cropbox(cropbox)

        lines = p_info.get("lines")
        if lines:
            for pt, txt in lines:
                page.insert_text(pt, txt)
        elif "text" in p_info and p_info["text"]:
            page.insert_text(fitz.Point(50, 72), p_info["text"])

    pdf_bytes = doc.tobytes()
    doc.close()
    return pdf_bytes


# ==============================================================================
# 1. Rotated Pages & Custom CropBoxes
# ==============================================================================

class TestRotatedPagesAndCropboxes:
    """Probing coordinate space integrity under rotation and custom cropboxes."""

    @pytest.mark.parametrize("rotation", [0, 90, 180, 270])
    def test_page_rotations_bounding_box_validity(self, rotation: int):
        """Assert all extracted word bboxes and normalized bboxes remain strictly in [0.0, 1.0]."""
        text = "Deep Learning architectures rely on backpropagation through computational graphs."
        pdf_bytes = create_pdf([{"text": text, "rotation": rotation}])

        pages = extract_pdf_pages_sync(pdf_bytes)
        assert len(pages) == 1
        page = pages[0]
        assert page.width > 0
        assert page.height > 0
        assert len(page.words) > 0

        # Build sentence spans
        spans = build_page_sentence_spans(page)
        assert len(spans) > 0

        for span in spans:
            for box in span.bboxes:
                assert len(box) == 4
                x0, y0, x1, y1 = box
                assert 0.0 <= x0 <= 1.0, f"x0 out of bounds ({x0}) at rotation {rotation}"
                assert 0.0 <= y0 <= 1.0, f"y0 out of bounds ({y0}) at rotation {rotation}"
                assert 0.0 <= x1 <= 1.0, f"x1 out of bounds ({x1}) at rotation {rotation}"
                assert 0.0 <= y1 <= 1.0, f"y1 out of bounds ({y1}) at rotation {rotation}"
                assert x0 <= x1, f"x0 ({x0}) > x1 ({x1}) at rotation {rotation}"
                assert y0 <= y1, f"y0 ({y0}) > y1 ({y1}) at rotation {rotation}"

    def test_custom_cropbox_bounding_box_normalization(self):
        """Test extraction and normalization on a PDF with a non-zero origin CropBox."""
        doc = fitz.open()
        page = doc.new_page(width=612, height=792)
        # Insert text inside the cropped area
        page.insert_text(fitz.Point(150, 150), "Text inside cropped viewport.")
        # Set cropbox with non-zero origin (x0=100, y0=100, x1=500, y1=700)
        crop = fitz.Rect(100, 100, 500, 700)
        page.set_cropbox(crop)
        pdf_bytes = doc.tobytes()
        doc.close()

        pages = extract_pdf_pages_sync(pdf_bytes)
        assert len(pages) == 1
        page = pages[0]
        # Crop width is 400, height is 600
        assert page.width == 400.0
        assert page.height == 600.0

        spans = build_page_sentence_spans(page)
        assert len(spans) > 0
        for span in spans:
            for box in span.bboxes:
                x0, y0, x1, y1 = box
                assert 0.0 <= x0 <= 1.0, f"x0 {x0} outside [0.0, 1.0]"
                assert 0.0 <= y0 <= 1.0, f"y0 {y0} outside [0.0, 1.0]"
                assert 0.0 <= x1 <= 1.0, f"x1 {x1} outside [0.0, 1.0]"
                assert 0.0 <= y1 <= 1.0, f"y1 {y1} outside [0.0, 1.0]"

    def test_rotated_page_bottom_text_bbox_collapse(self):
        """
        Adversarial Test: Text near bottom of a portrait page (y=700, height=792)
        when rotated 90° (where display height becomes 612) has unrotated coordinates.
        Current implementation divides raw unrotated y by rotated height (612), causing
        y0 and y1 to collapse to 1.0 (zero-height bounding box) and distorting aspect ratio.
        """
        doc = fitz.open()
        page = doc.new_page(width=612, height=792)
        page.insert_text(fitz.Point(50, 700), "Footer text near page bottom.")
        page.set_rotation(90)
        pdf_bytes = doc.tobytes()
        doc.close()

        pages = extract_pdf_pages_sync(pdf_bytes)
        p = pages[0]
        spans = build_page_sentence_spans(p)
        assert len(spans) == 1
        box = spans[0].bboxes[0]
        # In a correct coordinate system, bounding box height must be strictly positive and not pinned to 1.0!
        bbox_height = box[3] - box[1]
        assert bbox_height > 0.005, (
            f"Bounding box height collapsed ({bbox_height}) with y0={box[1]}, y1={box[3]} "
            f"due to division by rotated page height without coordinate transformation!"
        )
        assert box[1] < 0.99, f"y0 ({box[1]}) improperly pinned to bottom boundary"

    def test_normalize_bbox_inversion_and_clamping(self):
        """Test direct normalize_bbox utility with negative/inverted/overflow coordinates."""
        # Inverted coords (raw_x0 > raw_x1, raw_y0 > raw_y1)
        box = normalize_bbox(raw_x0=500.0, raw_y0=600.0, raw_x1=100.0, raw_y1=200.0, page_width=1000.0, page_height=1000.0)
        assert box == [0.1, 0.2, 0.5, 0.6]

        # Out-of-bounds coords (<0 and >page_dim)
        box2 = normalize_bbox(raw_x0=-50.0, raw_y0=-10.0, raw_x1=1200.0, raw_y1=1500.0, page_width=1000.0, page_height=1000.0)
        assert box2 == [0.0, 0.0, 1.0, 1.0]

        # Zero or negative page dimensions
        with pytest.raises(ValueError):
            normalize_bbox(0, 0, 10, 10, page_width=0, page_height=100)
        with pytest.raises(ValueError):
            normalize_bbox(0, 0, 10, 10, page_width=100, page_height=-50)


# ==============================================================================
# 2. Multiline Sentence Bounding Boxes
# ==============================================================================

class TestMultilineSentenceBoundingBoxes:
    """Probing line-by-line bounding box aggregation for multiline sentences."""

    def test_three_line_sentence_distinct_bboxes(self):
        """A sentence spanning 3 distinct lines produces exactly 3 non-overlapping bboxes."""
        words = [
            ExtractedWord(text="Line", x0=50, y0=50, x1=80, y1=65, block_no=0, line_no=0, word_no=0),
            ExtractedWord(text="one", x0=85, y0=50, x1=110, y1=65, block_no=0, line_no=0, word_no=1),
            ExtractedWord(text="Line", x0=50, y0=75, x1=80, y1=90, block_no=0, line_no=1, word_no=2),
            ExtractedWord(text="two", x0=85, y0=75, x1=110, y1=90, block_no=0, line_no=1, word_no=3),
            ExtractedWord(text="Line", x0=50, y0=100, x1=80, y1=115, block_no=0, line_no=2, word_no=4),
            ExtractedWord(text="three.", x0=85, y0=100, x1=125, y1=115, block_no=0, line_no=2, word_no=5),
        ]
        bboxes = aggregate_multiline_bboxes(words, page_width=500.0, page_height=1000.0)
        assert len(bboxes) == 3
        # Strict vertical monotonicity
        assert bboxes[0][1] < bboxes[1][1] < bboxes[2][1]
        assert bboxes[0][3] <= bboxes[1][1]
        assert bboxes[1][3] <= bboxes[2][1]

    def test_single_line_sentence_single_bbox(self):
        """A single line sentence produces exactly 1 bbox."""
        words = [
            ExtractedWord(text="Single", x0=50, y0=50, x1=90, y1=65, block_no=0, line_no=0, word_no=0),
            ExtractedWord(text="line.", x0=95, y0=50, x1=130, y1=65, block_no=0, line_no=0, word_no=1),
        ]
        bboxes = aggregate_multiline_bboxes(words, page_width=500.0, page_height=1000.0)
        assert len(bboxes) == 1
        assert bboxes[0] == [0.1, 0.05, 0.26, 0.065]

    def test_empty_words_returns_empty_bboxes(self):
        """Empty words list returns empty bboxes without error."""
        bboxes = aggregate_multiline_bboxes([], page_width=500.0, page_height=1000.0)
        assert bboxes == []

    def test_multiple_sentences_on_page_word_matching(self):
        """Verify match_sentence_to_words correctly steps through multiple sentences without swallowing."""
        page = ExtractedPage(
            page_number=1,
            text="First sentence here. Second sentence follows. Third sentence ends.",
            width=500.0,
            height=1000.0,
            words=[
                ExtractedWord("First", 10, 10, 40, 20, 0, 0, 0),
                ExtractedWord("sentence", 45, 10, 90, 20, 0, 0, 1),
                ExtractedWord("here.", 95, 10, 130, 20, 0, 0, 2),
                ExtractedWord("Second", 10, 30, 50, 40, 0, 1, 3),
                ExtractedWord("sentence", 55, 30, 100, 40, 0, 1, 4),
                ExtractedWord("follows.", 105, 30, 150, 40, 0, 1, 5),
                ExtractedWord("Third", 10, 50, 40, 60, 0, 2, 6),
                ExtractedWord("sentence", 45, 50, 90, 60, 0, 2, 7),
                ExtractedWord("ends.", 95, 50, 130, 60, 0, 2, 8),
            ],
        )
        spans = build_page_sentence_spans(page)
        assert len(spans) == 3
        assert spans[0].text == "First sentence here."
        assert len(spans[0].bboxes) == 1
        assert spans[1].text == "Second sentence follows."
        assert len(spans[1].bboxes) == 1
        assert spans[2].text == "Third sentence ends."
        assert len(spans[2].bboxes) == 1

    def test_real_pdf_wrapped_sentence_multiline_bboxes(self):
        """
        Adversarial Test: An actual PDF sentence that wraps across 3 lines in a textbox
        should be recognized as a SINGLE sentence span with 3 line-level bounding boxes,
        not fragmented into 3 separate incomplete sentence pieces.
        """
        doc = fitz.open()
        page = doc.new_page(width=300, height=500)
        rect = fitz.Rect(50, 50, 250, 450)
        wrapped_sentence = (
            "This is a cohesive multi-line sentence that wraps across three visual lines "
            "and ends with a period here."
        )
        page.insert_textbox(rect, wrapped_sentence)
        pdf_bytes = doc.tobytes()
        doc.close()

        pages = extract_pdf_pages_sync(pdf_bytes)
        assert len(pages) == 1
        p = pages[0]

        spans = build_page_sentence_spans(p)
        # Expected: 1 coherent sentence with multiple bounding boxes
        assert len(spans) == 1, (
            f"Expected 1 sentence span with multiline bboxes, but got {len(spans)} spans "
            f"due to line-break fragmentation: {[s.text for s in spans]}"
        )
        assert len(spans[0].bboxes) >= 2, f"Expected multiple bboxes for multiline sentence, got {len(spans[0].bboxes)}"


# ==============================================================================
# 3. Sentence Boundary & Bullet Pre-Splitting Regex
# ==============================================================================

class TestBulletAndSentenceSplitting:
    """Probing bullet pre-splitting without false splits on decimals, hyphens, abbreviations."""

    def test_bullet_pattern_regex(self):
        """Test regex matching behavior directly."""
        assert BULLET_PATTERN.match("• Bullet item")
        assert BULLET_PATTERN.match("* Bullet item")
        assert BULLET_PATTERN.match("- Bullet item")
        assert BULLET_PATTERN.match("1. Numbered item")
        assert BULLET_PATTERN.match("  42. Indented item")
        assert BULLET_PATTERN.match("   - Indented dash")

        # Must NOT match:
        assert not BULLET_PATTERN.match("-5.4 is negative")
        assert not BULLET_PATTERN.match("3.14159 is pi")
        assert not BULLET_PATTERN.match("state-of-the-art")
        assert not BULLET_PATTERN.match("5 * 10 = 50")
        assert not BULLET_PATTERN.match("Dr. Smith said")

    def test_segment_sentences_preserves_decimals_and_hyphens(self):
        """Decimals, inline hyphens, and math symbols do not cause false splits."""
        text = (
            "The experiment recorded -4.5 degrees at t = 3.14 seconds. "
            "We used a state-of-the-art sensor measuring 5 * 10 samples per second."
        )
        sents = segment_sentences_with_bullets(text)
        assert len(sents) == 2
        assert "3.14" in sents[0]
        assert "state-of-the-art" in sents[1]
        assert "5 * 10" in sents[1]

    def test_segment_sentences_preserves_abbreviations(self):
        """Titles and abbreviations (Dr., Prof., e.g., i.e., Fig., U.S.) are not split."""
        text = "Prof. Xavier and Dr. McCoy met at 9 a.m. in Washington, D.C. to discuss Fig. 4."
        sents = segment_sentences_with_bullets(text)
        assert len(sents) == 1
        assert "Prof. Xavier and Dr. McCoy" in sents[0]

    def test_multiline_mixed_bullets(self):
        """Mixed bullet list (bullets, numbers, dashes) segments cleanly."""
        text = (
            "Here is the summary of topics:\n"
            "• Machine learning algorithms\n"
            "* Neural network layers\n"
            "1. Supervised learning\n"
            "2. Unsupervised learning\n"
            "- Reinforcement learning"
        )
        sents = segment_sentences_with_bullets(text)
        assert len(sents) == 6
        assert "Machine learning algorithms" in sents[1]
        assert "Neural network layers" in sents[2]
        assert "Supervised learning" in sents[3]
        assert "Unsupervised learning" in sents[4]
        assert "Reinforcement learning" in sents[5]

    def test_empty_or_whitespace_text(self):
        """Empty or whitespace text returns empty list."""
        assert segment_sentences_with_bullets("") == []
        assert segment_sentences_with_bullets("   \n\t  ") == []


# ==============================================================================
# 4. Scanned Page Threshold & Gemini Vision OCR Coordinates
# ==============================================================================

class TestScannedThresholdAndOCR:
    """Probing scanned page threshold (<50 chars) and OCR mapping."""

    @pytest.mark.parametrize("char_count,expected_scanned", [
        (0, True),
        (10, True),
        (49, True),
        (50, False),
        (51, False),
        (100, False),
    ])
    def test_scanned_page_threshold_boundary(self, char_count: int, expected_scanned: bool):
        """Boundary test at exactly 49, 50, 51 characters."""
        text = "A" * char_count
        pdf_bytes = create_pdf([{"text": text}])
        pages = extract_pdf_pages_sync(pdf_bytes)
        assert len(pages) == 1
        assert pages[0].is_scanned == expected_scanned

    def test_gemini_vision_ocr_mapping(self):
        """Test OCR coordinate transformation from [ymin, xmin, ymax, xmax] in [0, 1000] to [x0, y0, x1, y1] in [0.0, 1.0]."""
        # Standard box: ymin=100, xmin=200, ymax=300, xmax=400
        converted = convert_gemini_vision_bbox(100, 200, 300, 400)
        assert converted == [0.2, 0.1, 0.4, 0.3]

        # Inverted box: ymin > ymax, xmin > xmax
        inverted = convert_gemini_vision_bbox(300, 400, 100, 200)
        assert inverted == [0.2, 0.1, 0.4, 0.3]

        # Extreme limits: [0, 0, 1000, 1000]
        extremes = convert_gemini_vision_bbox(0, 0, 1000, 1000)
        assert extremes == [0.0, 0.0, 1.0, 1.0]


# ==============================================================================
# 5. Zero Page Bleeding
# ==============================================================================

class TestZeroPageBleeding:
    """Probing zero page bleeding across physical pages."""

    def test_sentences_do_not_bleed_across_pages(self):
        """Sentences starting on page 1 and ending on page 2 are partitioned strictly by page."""
        p1 = ExtractedPage(
            page_number=1,
            text="The quick brown fox jumps over the lazy dog. Page one concludes.",
            width=612.0,
            height=792.0,
        )
        p2 = ExtractedPage(
            page_number=2,
            text="Page two begins. Another sentence follows immediately.",
            width=612.0,
            height=792.0,
        )

        chunks = chunk_document_pages(
            pages=[p1, p2],
            source_id="src_bleed",
            notebook_id="nb_1",
            user_id="usr_1",
            ingest_run_id="run_1",
            ingested_at=1000,
            embedding_model="gemini-embedding-2",
            source_title="Bleed Test",
        )

        assert len(chunks) >= 2
        for c in chunks:
            if c.page_number == 1:
                assert "Page two begins" not in c.text
                assert c.chunk_id.startswith("src_bleed_p0001_")
            elif c.page_number == 2:
                assert "Page one concludes" not in c.text
                assert c.chunk_id.startswith("src_bleed_p0002_")

    def test_deterministic_chunk_and_point_ids(self):
        """Verify chunk ID formatting {source_id}_p{page:04d}_c{idx:03d} and UUIDv5 DNS point ID."""
        c_id = "source123_p0004_c007"
        pt_id = generate_qdrant_point_id("run_xyz", c_id)
        # Determinism check: re-running gives identical UUID
        pt_id_repeat = generate_qdrant_point_id("run_xyz", c_id)
        assert pt_id == pt_id_repeat
        assert len(pt_id) == 36


# ==============================================================================
# 6. Corrupted & Malformed PDF Handling
# ==============================================================================

class TestCorruptedPDFHandling:
    """Probing resilience against malformed, empty, encrypted, and truncated PDFs."""

    def test_empty_bytes_raises_corrupt_pdf_error(self):
        """Empty byte string raises CorruptPDFError with ERR_CORRUPT_FILE."""
        with pytest.raises(CorruptPDFError) as exc_info:
            extract_pdf_pages_sync(b"")
        assert exc_info.value.error_code == "ERR_CORRUPT_FILE"

    def test_random_binary_garbage_raises_corrupt_pdf_error(self):
        """Random binary garbage raises CorruptPDFError with ERR_CORRUPT_FILE."""
        garbage = b"\x00\xff\xfe\xfd\x01\x02\x03\x04CORRUPTED_NON_PDF_DATA_STREAM"
        with pytest.raises(CorruptPDFError) as exc_info:
            extract_pdf_pages_sync(garbage)
        assert exc_info.value.error_code == "ERR_CORRUPT_FILE"

    def test_truncated_pdf_header_raises_corrupt_pdf_error(self):
        """Truncated PDF with valid header but incomplete structure."""
        truncated = b"%PDF-1.4\n%EOF"
        with pytest.raises(CorruptPDFError) as exc_info:
            extract_pdf_pages_sync(truncated)
        assert exc_info.value.error_code == "ERR_CORRUPT_FILE"

    def test_zero_page_pdf_raises_corrupt_pdf_error(self):
        """A PDF with 0 pages raises CorruptPDFError."""
        # Minimal valid PDF structure with 0 pages (/Count 0)
        zero_page_pdf = (
            b"%PDF-1.4\n"
            b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n"
            b"2 0 obj\n<< /Type /Pages /Count 0 /Kids [] >>\nendobj\n"
            b"xref\n0 3\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n"
            b"trailer\n<< /Size 3 /Root 1 0 R >>\nstartxref\n115\n%%EOF\n"
        )

        with pytest.raises(CorruptPDFError) as exc_info:
            extract_pdf_pages_sync(zero_page_pdf)
        assert exc_info.value.error_code == "ERR_CORRUPT_FILE"
        assert "0 pages" in str(exc_info.value)
