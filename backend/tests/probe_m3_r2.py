"""
Adversarial Probe Suite for Milestone 3 Remediation Verification
"""

import asyncio
import re
import fitz  # PyMuPDF
from app.services.pdf_service import (
    ExtractedPage,
    ExtractedWord,
    aggregate_multiline_bboxes,
    extract_pdf_pages_sync,
    normalize_bbox,
)
from app.services.chunking_service import (
    build_page_sentence_spans,
    chunk_document_pages,
    chunk_page_sentences,
    count_tokens,
    segment_sentences_with_bullets,
)


def probe_multiline_soft_linebreaks():
    print("=== PROBE 1: Multiline Soft Linebreaks ===")
    doc = fitz.open()
    page = doc.new_page(width=612, height=792)
    # Insert multiline textbox
    rect = fitz.Rect(50, 50, 300, 300)
    text = (
        "This is an extended academic sentence that naturally wraps across several visual lines "
        "on the rendered page to test whether soft linebreaks are normalized without splitting the sentence. "
        "Here is the second sentence that also spans multiple lines to ensure contiguous aggregation."
    )
    page.insert_textbox(rect, text, fontsize=12)
    pdf_bytes = doc.tobytes()
    doc.close()

    pages = extract_pdf_pages_sync(pdf_bytes)
    p0 = pages[0]
    print(f"Extracted page text:\n{p0.text!r}")
    print(f"Words extracted count: {len(p0.words)}")

    spans = build_page_sentence_spans(p0)
    print(f"Sentence spans count: {len(spans)}")
    for i, s in enumerate(spans):
        print(f"  Span {i}: text={s.text[:50]}... bboxes={s.bboxes}")
        # Verify bboxes is List[List[float]]
        assert isinstance(s.bboxes, list), "bboxes is not list"
        assert len(s.bboxes) > 1, f"Expected multiline bboxes > 1 for wrapped sentence, got {len(s.bboxes)}"
        for b in s.bboxes:
            assert len(b) == 4, f"Box {b} does not have 4 coordinates"
            assert all(0.0 <= c <= 1.0 for c in b), f"Box {b} coordinate out of [0.0, 1.0]"
            assert b[0] <= b[2] and b[1] <= b[3], f"Invalid bbox ordering: {b}"

    print("PROBE 1 PASSED: Multiline soft linebreaks successfully produced line-by-line bounding boxes in List[List[float]]\n")


def probe_rotated_pages_and_origins():
    print("=== PROBE 2: Rotated PDF Pages & Custom Origins ===")
    rotations = [0, 90, 180, 270]

    for rot in rotations:
        doc = fitz.open()
        p = doc.new_page(width=612, height=792)
        p.insert_text(fitz.Point(100, 150), "First line of rotated text for coordinate probe.")
        p.insert_text(fitz.Point(100, 250), "Second line situated lower on the page.")
        p.set_rotation(rot)
        pdf_bytes = doc.tobytes()
        doc.close()

        pages = extract_pdf_pages_sync(pdf_bytes)
        p0 = pages[0]
        print(f"Rotation {rot}°: page_width={p0.width}, page_height={p0.height}, origin_x0={p0.origin_x0}, origin_y0={p0.origin_y0}")
        print(f"  Extracted words count: {len(p0.words)}")

        spans = build_page_sentence_spans(p0)
        for s in spans:
            for b in s.bboxes:
                print(f"  Rot {rot}° bbox: {b}")
                for coord in b:
                    assert 0.0 <= coord <= 1.0, f"Coordinate {coord} out of bounds [0.0, 1.0] for rot={rot}"
                assert b[0] <= b[2], f"x0 > x1 in {b}"
                assert b[1] <= b[3], f"y0 > y1 in {b}"

    print("PROBE 2 PASSED: Rotated pages (0°, 90°, 180°, 270°) stay strictly within [0.0, 1.0]\n")


def probe_custom_cropbox_origins():
    print("=== PROBE 3: Custom CropBox / Displaced Origins ===")
    doc = fitz.open()
    p = doc.new_page(width=612, height=792)
    p.insert_text(fitz.Point(200, 300), "Text inside cropped sub-region of page.")
    # Set cropbox with non-zero origin
    p.set_cropbox(fitz.Rect(100, 200, 500, 600))
    pdf_bytes = doc.tobytes()
    doc.close()

    pages = extract_pdf_pages_sync(pdf_bytes)
    p0 = pages[0]
    print(f"CropBox page: width={p0.width}, height={p0.height}, origin_x0={p0.origin_x0}, origin_y0={p0.origin_y0}")
    spans = build_page_sentence_spans(p0)
    for s in spans:
        for b in s.bboxes:
            print(f"  CropBox bbox: {b}")
            for coord in b:
                assert 0.0 <= coord <= 1.0, f"CropBox coord {coord} out of bounds [0.0, 1.0]"
            assert b[0] <= b[2]
            assert b[1] <= b[3]

    print("PROBE 3 PASSED: Custom cropbox non-zero origin correctly normalized into [0.0, 1.0]\n")


def probe_bullet_presplitting_and_page_bleeding():
    print("=== PROBE 4: Bullet Pre-Splitting and Zero Page Bleed ===")
    bullet_text = (
        "Here is the introduction before bullet items:\n"
        "• First bullet item covering machine learning foundations.\n"
        "• Second bullet item covering deep neural architectures.\n"
        "1. Third numbered item explaining backpropagation.\n"
        "- Fourth dashed item concluding the list.\n"
        "Final paragraph following the list."
    )
    sents = segment_sentences_with_bullets(bullet_text)
    print(f"Bullet segments count: {len(sents)}")
    for i, s in enumerate(sents):
        print(f"  Segment {i}: {s!r}")
    assert any("First bullet" in s for s in sents)
    assert any("Second bullet" in s for s in sents)
    assert any("Third numbered" in s for s in sents)
    assert any("Fourth dashed" in s for s in sents)

    # Page bleeding probe
    p1 = ExtractedPage(page_number=1, text="Page 1 sentence ending here.", width=612, height=792)
    p2 = ExtractedPage(page_number=2, text="Page 2 sentence continuing thought.", width=612, height=792)
    chunks = chunk_document_pages(
        pages=[p1, p2],
        source_id="src_test",
        notebook_id="nb_test",
        user_id="usr_test",
        ingest_run_id="run_1",
        ingested_at=1000,
        embedding_model="gemini-embedding-2",
        source_title="Bleed Test",
    )
    print(f"Chunks generated: {len(chunks)}")
    for c in chunks:
        print(f"  Chunk {c.chunk_id}: page={c.page_number}, text={c.text!r}")
        assert c.chunk_id.split("_p")[1].startswith(f"{c.page_number:04d}")
        # Assert no text from page 2 is in page 1 chunk
        if c.page_number == 1:
            assert "Page 2" not in c.text
        if c.page_number == 2:
            assert "Page 1" not in c.text

    print("PROBE 4 PASSED: Bullets pre-split cleanly and page bleeding is strictly zero.\n")


def probe_chunk_sizing_and_token_count():
    print("=== PROBE 5: Chunk Sizing Calculation & test_ing_14 Failure ===")
    # Replicate test_ing_14 setup:
    page = ExtractedPage(
        page_number=1,
        text=" ".join([f"Sentence {i} describing fundamental physics principles." for i in range(80)]),
        width=612.0,
        height=792.0,
    )
    chunks = chunk_page_sentences(
        page=page,
        source_id="src_pdf_1",
        notebook_id="nb_1",
        user_id="usr_1",
        ingest_run_id="run_1",
        ingested_at=1000,
        embedding_model="gemini-embedding-2",
        source_title="Physics Notes",
    )
    print(f"Generated {len(chunks)} chunks.")
    for i, chunk in enumerate(chunks):
        tok_count = count_tokens(chunk.text)
        print(f"  Chunk {i} ({chunk.chunk_id}): words={len(chunk.text.split())}, tokens={tok_count}")
        if tok_count > 450:
            print(f"  --> VIOLATION: tok_count {tok_count} > 450 in chunk {chunk.chunk_id}!")


def main():
    probe_multiline_soft_linebreaks()
    probe_rotated_pages_and_origins()
    probe_custom_cropbox_origins()
    probe_bullet_presplitting_and_page_bleeding()
    probe_chunk_sizing_and_token_count()


if __name__ == "__main__":
    main()
