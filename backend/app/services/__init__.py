"""Services Package."""

from app.services.auth_service import (
    verify_google_id_token,
    create_access_token,
    decode_access_token,
    get_current_user,
)
from app.services.qdrant_service import (
    get_qdrant_client,
    build_tenant_filter,
    execute_tenant_retrieval,
    upsert_chunk_points,
    delete_tenant_vectors,
)
from app.services.storage_service import (
    StorageService,
    get_storage_service,
    build_storage_key,
    build_scoped_key,
    sanitize_filename,
    parse_storage_key,
    upload_file,
    get_file_bytes,
    get_file_range,
    delete_file,
    delete_prefix,
    generate_presigned_url,
    parse_byte_range,
    build_range_response,
    cleanup_orphan_file,
    orphan_upload_shield,
    reconcile_orphan_r2_objects,
    StorageError,
    StorageServiceError,
    StorageNotFoundError,
    StorageInvalidKeyError,
    StorageRangeNotSatisfiableError,
)
from app.services.pdf_service import (
    CorruptPDFError,
    ExtractedPage,
    ExtractedWord,
    normalize_bbox,
    convert_gemini_vision_bbox,
    aggregate_multiline_bboxes,
    extract_pdf_pages,
    extract_pdf_pages_sync,
)
from app.services.chunking_service import (
    count_tokens,
    segment_sentences_with_bullets,
    match_sentence_to_words,
    build_page_sentence_spans,
    chunk_page_sentences,
    chunk_document_pages,
    generate_qdrant_point_id,
)
from app.services.moderation_service import (
    EducationalModerationService,
    get_moderation_service,
)
from app.services.youtube_service import (
    YouTubeService,
    YouTubeError,
    YouTubeTranscriptUnavailableError,
    YouTubeNonEducationalContentError,
)

from app.services.embedding_service import (
    EmbeddingService,
    get_embedding_service,
)
from app.services.rerank_service import (
    BM25Scorer,
    RerankService,
    get_rerank_service,
)
from app.services.citation_service import (
    CitationService,
    StreamingSentenceBuffer,
    get_citation_service,
)
from app.services.intent_router import (
    IntentRouter,
    QueryRewriter,
    PromptSanitizer,
)
from app.services.summary_service import (
    SummaryService,
)

__all__ = [
    "verify_google_id_token",
    "create_access_token",
    "decode_access_token",
    "get_current_user",
    "get_qdrant_client",
    "build_tenant_filter",
    "execute_tenant_retrieval",
    "upsert_chunk_points",
    "delete_tenant_vectors",
    "StorageService",
    "get_storage_service",
    "build_storage_key",
    "build_scoped_key",
    "sanitize_filename",
    "parse_storage_key",
    "upload_file",
    "get_file_bytes",
    "get_file_range",
    "delete_file",
    "delete_prefix",
    "generate_presigned_url",
    "parse_byte_range",
    "build_range_response",
    "cleanup_orphan_file",
    "orphan_upload_shield",
    "reconcile_orphan_r2_objects",
    "StorageError",
    "StorageServiceError",
    "StorageNotFoundError",
    "StorageInvalidKeyError",
    "StorageRangeNotSatisfiableError",
    "CorruptPDFError",
    "ExtractedPage",
    "ExtractedWord",
    "normalize_bbox",
    "convert_gemini_vision_bbox",
    "aggregate_multiline_bboxes",
    "extract_pdf_pages",
    "extract_pdf_pages_sync",
    "count_tokens",
    "segment_sentences_with_bullets",
    "match_sentence_to_words",
    "build_page_sentence_spans",
    "chunk_page_sentences",
    "chunk_document_pages",
    "generate_qdrant_point_id",
    "EducationalModerationService",
    "get_moderation_service",
    "YouTubeService",
    "YouTubeError",
    "YouTubeTranscriptUnavailableError",
    "YouTubeNonEducationalContentError",
    "EmbeddingService",
    "get_embedding_service",
    "BM25Scorer",
    "RerankService",
    "get_rerank_service",
    "CitationService",
    "StreamingSentenceBuffer",
    "get_citation_service",
    "IntentRouter",
    "QueryRewriter",
    "PromptSanitizer",
    "SummaryService",
]

