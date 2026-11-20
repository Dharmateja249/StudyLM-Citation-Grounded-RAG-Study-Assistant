"""
StudyLM YouTube Ingestion & Caption Processing Service.
File: backend/app/services/youtube_service.py

Implements:
- YouTube video URL validation and video ID extraction.
- Disabled / missing captions guard (ERR_YT_NO_TRANSCRIPT).
- pysbd sentence boundary segmentation and linear timestamp interpolation.
- Deterministic chunking: {source_id}_t{start_seconds:05d}_c{idx:03d}.
- Deep-link generation (https://www.youtube.com/watch?v={video_id}&t={start_seconds}s).
- Integration with Two-Tier Educational Content Barrier.
"""

from __future__ import annotations

import logging
import re
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import parse_qs, urlparse

import pysbd
from youtube_transcript_api import (
    YouTubeTranscriptApi,
    TranscriptsDisabled,
    NoTranscriptFound,
    VideoUnavailable,
    CouldNotRetrieveTranscript,
)

from app.config import get_settings
from app.models import ChunkPayload, EducationalCheckResult, SentenceSpan
from app.services.chunking_service import count_tokens
from app.services.moderation_service import EducationalModerationService, get_moderation_service

logger = logging.getLogger("studylm.youtube_service")
settings = get_settings()

YOUTUBE_VALID_HOSTS = {
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtu.be",
}

VIDEO_ID_REGEX = re.compile(r"^[a-zA-Z0-9_-]{11}$")

YOUTUBE_URL_REGEX = re.compile(
    r"^(?:https?:\/\/)?(?:www\.|m\.|music\.)?(?:youtube\.com\/(?:watch\?(?:[^ \t\r\n#]*&)?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})(?![a-zA-Z0-9_-])"
)


class YouTubeError(Exception):
    """Base exception for YouTube processing errors."""
    pass


class YouTubeTranscriptUnavailableError(YouTubeError):
    """Raised when YouTube captions are disabled, unavailable, or missing."""
    def __init__(self, message: str = "No English transcript or subtitles available for this YouTube video."):
        super().__init__(message)
        self.error_code = "ERR_YT_NO_TRANSCRIPT"


class YouTubeNonEducationalContentError(YouTubeError):
    """Raised when YouTube video is rejected by the Educational Content Barrier."""
    def __init__(self, message: Optional[str] = None):
        msg = message or settings.EDUCATIONAL_REJECTION_ERROR_MESSAGE
        super().__init__(msg)
        self.error_code = settings.EDUCATIONAL_REJECTION_ERROR_CODE


class YouTubeService:
    """Production service for YouTube video validation, transcription, and chunking."""

    def __init__(self, gemini_client: Optional[Any] = None, moderation_service: Optional[EducationalModerationService] = None):
        self.settings = get_settings()
        if gemini_client is None and self.settings.GEMINI_API_KEY and not self.settings.GEMINI_API_KEY.startswith("mock-") and self.settings.ENVIRONMENT != "testing":
            try:
                from google import genai
                gemini_client = genai.Client(api_key=self.settings.GEMINI_API_KEY)
            except Exception as e:
                logger.warning(f"Could not initialize default Gemini client for YouTubeService: {e}")
        self.gemini_client = gemini_client
        self.moderator = moderation_service or get_moderation_service(gemini_client=gemini_client)
        self.segmenter = pysbd.Segmenter(language="en", clean=False)

    def extract_video_id(self, url: str) -> str:
        """
        Extract 11-character video ID from diverse YouTube URL patterns.
        Strictly enforces:
        - Scheme in ('http', 'https') or scheme-less YouTube URL.
        - Hostname matches trusted YouTube domains (youtube.com, www.youtube.com, m.youtube.com, music.youtube.com, youtu.be).
        - Video ID must be exactly 11 characters conforming to [a-zA-Z0-9_-]{11}.
        - Hostile protocols (ftp, javascript, data, file) and foreign domains are rejected with ValueError.
        """
        if not url or not isinstance(url, str) or not url.strip():
            raise ValueError("URL cannot be empty")

        raw = url.strip()
        parsed = urlparse(raw)

        # 1. Validate scheme
        if parsed.scheme:
            if parsed.scheme.lower() not in ("http", "https"):
                raise ValueError(f"Invalid URL scheme '{parsed.scheme}'. Only HTTP and HTTPS are allowed.")
            hostname = parsed.hostname
        else:
            if raw.startswith("//"):
                re_parsed = urlparse("https:" + raw)
            else:
                re_parsed = urlparse("https://" + raw)
            parsed = re_parsed
            hostname = parsed.hostname

        if not hostname:
            raise ValueError(f"Missing hostname in YouTube URL: {url}")

        hostname = hostname.lower()
        if hostname not in YOUTUBE_VALID_HOSTS:
            raise ValueError(f"Foreign or invalid YouTube domain '{hostname}' in URL: {url}")

        # 2. Extract candidate video ID
        candidate_id: Optional[str] = None
        if hostname == "youtu.be":
            parts = [p for p in parsed.path.split("/") if p]
            if len(parts) == 1:
                candidate_id = parts[0]
        else:
            clean_path = parsed.path.rstrip("/").lower()
            if clean_path == "/watch":
                qs = parse_qs(parsed.query)
                v_list = qs.get("v")
                if v_list and len(v_list) == 1 and v_list[0]:
                    candidate_id = v_list[0]
            elif clean_path.startswith("/embed/"):
                parts = [p for p in parsed.path.split("/") if p]
                if len(parts) == 2:
                    candidate_id = parts[1]
            elif clean_path.startswith("/v/"):
                parts = [p for p in parsed.path.split("/") if p]
                if len(parts) == 2:
                    candidate_id = parts[1]
            elif clean_path.startswith("/shorts/"):
                parts = [p for p in parsed.path.split("/") if p]
                if len(parts) == 2:
                    candidate_id = parts[1]

        if not candidate_id or not VIDEO_ID_REGEX.match(candidate_id):
            raise ValueError(f"Invalid YouTube URL format or video ID: {url}")

        return candidate_id

    def build_deep_link(self, video_id: str, start_seconds: float) -> str:
        """Construct deep-link URL jumping directly to t=X parameter."""
        sec_int = max(0, int(start_seconds))
        return f"https://www.youtube.com/watch?v={video_id}&t={sec_int}s"

    async def get_video_metadata(self, video_id: str, title: Optional[str] = None) -> Dict[str, Any]:
        """
        Retrieves authentic video title, description, and author.
        Fetches official YouTube title via public oEmbed endpoint.
        Falls back to provided title or sensible defaults.
        """
        resolved_title = title if (title and not title.startswith("YouTube Video")) else None
        channel_name = ""
        description = ""

        # Fetch authentic YouTube title & channel via official oEmbed API
        try:
            import httpx
            oembed_url = f"https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={video_id}&format=json"
            async with httpx.AsyncClient(timeout=5.0) as client:
                res = await client.get(oembed_url)
                if res.status_code == 200:
                    data = res.json()
                    oembed_title = data.get("title", "").strip()
                    if oembed_title:
                        resolved_title = oembed_title
                    channel_name = data.get("author_name", "").strip()
        except Exception as e:
            logger.info(f"oEmbed metadata fetch failed for {video_id}: {e}")

        # If description is empty, attempt to preview first segments of transcript for educational context
        try:
            raw_transcript = self.fetch_raw_transcript(video_id)
            if raw_transcript:
                preview_texts = [seg.get("text", "") for seg in raw_transcript[:10]]
                description = " ".join(preview_texts)[:1000]
        except Exception:
            pass

        final_title = resolved_title or title or f"YouTube Video {video_id}"
        if not description:
            description = f"Video by {channel_name}: {final_title}" if channel_name else f"Video {final_title}"

        return {
            "id": video_id,
            "title": final_title,
            "description": description,
            "channel": channel_name,
            "tags": [channel_name] if channel_name else [],
        }

    # -------------------------------------------------------------------------
    # Two-Tier Educational Content Barrier Methods
    # -------------------------------------------------------------------------

    def evaluate_tier1_heuristics(
        self,
        title: str,
        description: str = "",
        tags: Optional[List[str]] = None,
    ) -> Optional[EducationalCheckResult]:
        return self.moderator.evaluate_tier1_heuristics(title, description, tags)

    async def evaluate_tier2_llm_classifier(
        self,
        title: str,
        description: str = "",
        tags: Optional[List[str]] = None,
    ) -> EducationalCheckResult:
        return await self.moderator.evaluate_tier2_llm_classifier(title, description, tags)

    async def check_educational_relevance(
        self,
        title: str,
        description: str = "",
        tags: Optional[List[str]] = None,
    ) -> EducationalCheckResult:
        return await self.moderator.check_educational_relevance(title, description, tags)

    # -------------------------------------------------------------------------
    # Caption Extraction & Guard
    # -------------------------------------------------------------------------

    def fetch_raw_transcript(self, video_id: str) -> List[Dict[str, Any]]:
        """
        Fetch transcript segments via youtube-transcript-api.
        Supports both modern instance-based API and legacy static get_transcript.
        Raises YouTubeTranscriptUnavailableError if captions are disabled or unavailable.
        """
        try:
            raw_segments = None
            # 1. Try modern instance method
            try:
                ytt = YouTubeTranscriptApi()
                if hasattr(ytt, "fetch"):
                    try:
                        raw_segments = ytt.fetch(video_id, languages=["en", "en-US", "en-GB"])
                    except Exception:
                        if hasattr(ytt, "list"):
                            tl = ytt.list(video_id)
                            transcript_obj = tl.find_transcript(["en", "en-US", "en-GB"])
                            raw_segments = transcript_obj.fetch()
            except Exception:
                pass

            # 2. Fallback to legacy/mocked static method
            if raw_segments is None:
                if hasattr(YouTubeTranscriptApi, "get_transcript"):
                    raw_segments = YouTubeTranscriptApi.get_transcript(
                        video_id,
                        languages=["en", "en-US", "en-GB"],
                    )

            if raw_segments is None:
                raise YouTubeTranscriptUnavailableError("No transcript found or captions unavailable")

            # 3. Standardize to List[Dict[str, Any]]
            standardized: List[Dict[str, Any]] = []
            for seg in raw_segments:
                if isinstance(seg, dict):
                    standardized.append(seg)
                else:
                    standardized.append({
                        "text": getattr(seg, "text", ""),
                        "start": getattr(seg, "start", 0.0),
                        "duration": getattr(seg, "duration", 0.0),
                    })

            if not standardized:
                raise YouTubeTranscriptUnavailableError("Empty transcript returned")
            return standardized
        except (
            TranscriptsDisabled,
            NoTranscriptFound,
            VideoUnavailable,
            CouldNotRetrieveTranscript,
        ) as exc:
            logger.warning(f"YouTube captions unavailable for video {video_id}: {exc}")
            raise YouTubeTranscriptUnavailableError(str(exc)) from exc
        except YouTubeTranscriptUnavailableError:
            raise
        except Exception as exc:
            logger.error(f"Unexpected error fetching transcript for {video_id}: {exc}")
            raise YouTubeTranscriptUnavailableError(str(exc)) from exc

    # -------------------------------------------------------------------------
    # Sentence Boundary & Timestamp Interpolation (ING-06)
    # -------------------------------------------------------------------------

    def interpolate_sentence_timestamps(
        self,
        raw_captions: List[Dict[str, Any]],
    ) -> List[SentenceSpan]:
        """
        Stitches raw caption segments and performs linear timestamp interpolation
        at sentence boundaries detected by pysbd.
        """
        if not raw_captions:
            return []

        # 1. Build character timeline and stitched text
        stitched_text = ""
        seg_spans: List[Tuple[int, int, float, float, str]] = []

        for item in raw_captions:
            raw_text = (item.get("text") or "").strip().replace("\n", " ")
            if not raw_text:
                continue
            if stitched_text and not stitched_text.endswith(" "):
                stitched_text += " "
            start_char = len(stitched_text)
            stitched_text += raw_text
            end_char = len(stitched_text)
            seg_spans.append((
                start_char,
                end_char,
                float(item.get("start", 0.0)),
                float(item.get("duration", 0.0)),
                raw_text,
            ))

        if not stitched_text.strip():
            return []

        # 2. Segment sentences with pysbd
        raw_sentences = self.segmenter.segment(stitched_text)
        if not isinstance(raw_sentences, list):
            raw_sentences = [str(raw_sentences)]

        sentence_spans: List[SentenceSpan] = []
        current_search_idx = 0

        for i, s_text in enumerate(raw_sentences):
            s_clean = s_text.strip()
            if not s_clean:
                continue

            s_start_char = stitched_text.find(s_clean, current_search_idx)
            if s_start_char == -1:
                s_start_char = current_search_idx
            s_end_char = s_start_char + len(s_clean)
            current_search_idx = s_end_char

            # Linear interpolation for start_seconds
            t_start = 0.0
            for (c_start, c_end, seg_start, seg_dur, seg_t) in seg_spans:
                if c_start <= s_start_char <= c_end or s_start_char < c_start:
                    fraction = 0.0
                    if (c_end - c_start) > 0:
                        fraction = max(0.0, min(1.0, (s_start_char - c_start) / (c_end - c_start)))
                    t_start = round(seg_start + fraction * seg_dur, 2)
                    break
                t_start = round(seg_start + seg_dur, 2)

            # Linear interpolation for end_seconds
            t_end = t_start
            for (c_start, c_end, seg_start, seg_dur, seg_t) in seg_spans:
                if c_start <= s_end_char <= c_end or s_end_char <= c_start:
                    fraction = 1.0
                    if (c_end - c_start) > 0:
                        fraction = max(0.0, min(1.0, (s_end_char - c_start) / (c_end - c_start)))
                    t_end = round(seg_start + fraction * seg_dur, 2)
                    break
                t_end = round(seg_start + seg_dur, 2)

            if t_end < t_start:
                t_end = t_start

            sentence_spans.append(
                SentenceSpan(
                    sentence_id=f"s{i}",
                    text=s_clean,
                    bboxes=[],
                    start_seconds=t_start,
                    end_seconds=t_end,
                )
            )

        return sentence_spans

    # -------------------------------------------------------------------------
    # Chunk Generation & Formatting (ING-14)
    # -------------------------------------------------------------------------

    def build_youtube_chunks(
        self,
        sentences: List[SentenceSpan],
        source_id: str,
        notebook_id: str,
        user_id: str,
        ingest_run_id: str,
        source_title: str,
        target_tokens: int = 400,
        overlap_tokens: int = 50,
        ingested_at: int = 0,
    ) -> List[ChunkPayload]:
        """
        Group sentences into 400-token chunks with 50-token overlap.
        Enforces YouTube chunk ID format: {source_id}_t{start_seconds:05d}_c{idx:03d}
        """
        if not sentences:
            return []

        chunks: List[ChunkPayload] = []
        chunk_idx = 0
        current_sentences: List[SentenceSpan] = []
        current_tokens = 0

        for sentence in sentences:
            s_tok = count_tokens(sentence.text)
            if current_tokens + s_tok > target_tokens and current_sentences:
                # Flush chunk
                first_s = current_sentences[0]
                last_s = current_sentences[-1]
                start_sec = int(first_s.start_seconds or 0)
                end_sec = int(last_s.end_seconds or start_sec)
                chunk_id = f"{source_id}_t{start_sec:05d}_c{chunk_idx:03d}"
                chunk_text = " ".join(s.text for s in current_sentences)

                chunks.append(
                    ChunkPayload(
                        chunk_id=chunk_id,
                        source_id=source_id,
                        notebook_id=notebook_id,
                        user_id=user_id,
                        ingest_run_id=ingest_run_id,
                        ingested_at=ingested_at,
                        embedding_model=self.settings.GEMINI_EMBEDDING_MODEL,
                        source_title=source_title,
                        source_type="youtube",
                        page_number=None,
                        start_seconds=start_sec,
                        end_seconds=end_sec,
                        text=chunk_text,
                        sentences=list(current_sentences),
                    )
                )
                chunk_idx += 1

                # Overlap: keep trailing sentences matching overlap_tokens
                overlap_accum: List[SentenceSpan] = []
                overlap_count = 0
                for s in reversed(current_sentences):
                    overlap_accum.insert(0, s)
                    overlap_count += count_tokens(s.text)
                    if overlap_count >= overlap_tokens:
                        break
                current_sentences = list(overlap_accum)
                current_tokens = overlap_count

            current_sentences.append(sentence)
            current_tokens += s_tok

        # Flush final chunk
        if current_sentences:
            first_s = current_sentences[0]
            last_s = current_sentences[-1]
            start_sec = int(first_s.start_seconds or 0)
            end_sec = int(last_s.end_seconds or start_sec)
            chunk_id = f"{source_id}_t{start_sec:05d}_c{chunk_idx:03d}"
            chunk_text = " ".join(s.text for s in current_sentences)

            chunks.append(
                ChunkPayload(
                    chunk_id=chunk_id,
                    source_id=source_id,
                    notebook_id=notebook_id,
                    user_id=user_id,
                    ingest_run_id=ingest_run_id,
                    ingested_at=ingested_at,
                    embedding_model=self.settings.GEMINI_EMBEDDING_MODEL,
                    source_title=source_title,
                    source_type="youtube",
                    page_number=None,
                    start_seconds=start_sec,
                    end_seconds=end_sec,
                    text=chunk_text,
                    sentences=list(current_sentences),
                )
            )

        return chunks
