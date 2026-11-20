"""
StudyLM Hybrid Retrieval, BM25 Keyword Scoring & FlashRank Reranker.
File: backend/app/services/rerank_service.py

Implements:
- BM25 sparse keyword scoring with exact formula / identifier token matching (CIT-05).
- FlashRank cross-encoder reranking (ms-marco-TinyBERT-L-2-v2) with asyncio.to_thread CPU offloading.
- Hybrid Dense-Sparse fusion elevating exact term matches over dense semantic misses.
- Hallucination refusal threshold guard (< 0.40) (CIT-04).
"""

from __future__ import annotations

import asyncio
import logging
import math
import re
from typing import Any, Dict, List, Optional, Tuple

from app.config import get_settings

logger = logging.getLogger("studylm.rerank_service")
settings = get_settings()


STOPWORDS = {
    "what", "is", "are", "a", "an", "the", "in", "of", "to", "and", "for", "on", "with",
    "as", "by", "at", "be", "this", "that", "from", "or", "you", "it", "its", "their",
    "explain", "detail", "details", "me", "about", "how", "why", "can", "does", "do",
    "was", "were", "have", "has", "had", "tell", "give", "list", "show", "describe",
}


class BM25Scorer:
    """
    In-memory BM25 ranker for exact keyword and formula matching.
    Preserves alphanumeric terms, code identifiers, math symbols, and formulas.
    """

    def __init__(self, k1: float = 1.5, b: float = 0.75):
        self.k1 = k1
        self.b = b

    def tokenize(self, text: str, filter_stopwords: bool = False) -> List[str]:
        """
        Tokenizes text while retaining punctuation clusters, variable names, and math symbols.
        """
        # Split on whitespace while preserving punctuation tokens like formulas
        tokens = re.findall(r"[A-Za-z0-9_]+|[^\s\w]", text.lower())
        tokens = [t for t in tokens if t.strip()]
        if filter_stopwords:
            content_tokens = [t for t in tokens if t not in STOPWORDS]
            return content_tokens if content_tokens else tokens
        return tokens

    def score_documents(self, query: str, documents: List[str]) -> List[float]:
        """
        Computes BM25 score for a list of document texts against the query.
        Returns normalized scores in [0.0, 1.0].
        """
        if not documents:
            return []

        q_tokens = self.tokenize(query, filter_stopwords=True)
        if not q_tokens:
            return [0.0] * len(documents)

        doc_tokens_list = [self.tokenize(d, filter_stopwords=False) for d in documents]
        N = len(documents)
        doc_lens = [len(dt) for dt in doc_tokens_list]
        avgdl = sum(doc_lens) / N if N > 0 else 1.0
        if avgdl == 0:
            avgdl = 1.0

        # Compute document frequencies
        df: Dict[str, int] = {}
        for dt in doc_tokens_list:
            seen = set(dt)
            for token in seen:
                df[token] = df.get(token, 0) + 1

        scores: List[float] = []
        for i, dt in enumerate(doc_tokens_list):
            doc_len = doc_lens[i]
            tf: Dict[str, int] = {}
            for t in dt:
                tf[t] = tf.get(t, 0) + 1

            score = 0.0
            for qt in q_tokens:
                if qt not in tf:
                    continue
                doc_freq = df.get(qt, 0)
                # Robertson-Spärck Jones IDF
                idf = math.log((N - doc_freq + 0.5) / (doc_freq + 0.5) + 1.0)
                freq = tf[qt]
                numerator = freq * (self.k1 + 1.0)
                denominator = freq + self.k1 * (1.0 - self.b + self.b * (doc_len / avgdl))
                score += idf * (numerator / denominator)

            scores.append(score)

        # Normalize to [0.0, 1.0]
        max_score = max(scores) if scores else 0.0
        if max_score > 0:
            normalized = [s / max_score for s in scores]
        else:
            normalized = [0.0] * len(scores)

        return normalized


class RerankService:
    """
    Reranker combining dense vector similarity, BM25 sparse keyword matching,
    and FlashRank cross-encoder reranking.
    """

    def __init__(
        self,
        model_name: str = "ms-marco-TinyBERT-L-2-v2",
        refusal_threshold: Optional[float] = None,
    ):
        self.settings = get_settings()
        self.model_name = model_name
        self.refusal_threshold = (
            refusal_threshold
            if refusal_threshold is not None
            else self.settings.RETRIEVAL_REFUSAL_THRESHOLD
        )
        self.bm25 = BM25Scorer()
        self._flashrank_ranker: Optional[Any] = None

    def _get_ranker(self) -> Any:
        if self._flashrank_ranker is None:
            try:
                from flashrank import Ranker
                self._flashrank_ranker = Ranker(model_name=self.model_name)
            except Exception as e:
                logger.warning(f"[FLASHRANK_INIT_FAIL] Could not initialize FlashRank Ranker: {e}")
                self._flashrank_ranker = None
        return self._flashrank_ranker

    async def rerank_passages(
        self,
        query: str,
        passages: List[Dict[str, Any]],
        top_k: int = 5,
    ) -> Tuple[List[Dict[str, Any]], bool]:
        """
        CIT-04, CIT-05: Reranks candidate passages using hybrid dense-sparse scoring
        and FlashRank cross-encoder.

        Returns:
            Tuple of:
            - List of reranked passages with 'score', 'bm25_score', and 'rank' keys.
            - Boolean refusal_triggered: True if highest rerank score < refusal_threshold.
        """
        if not passages:
            return [], True

        # Offload computation to thread pool to preserve worker/server event loop
        return await asyncio.to_thread(self._sync_rerank, query, passages, top_k)

    def _sync_rerank(
        self,
        query: str,
        passages: List[Dict[str, Any]],
        top_k: int,
    ) -> Tuple[List[Dict[str, Any]], bool]:
        doc_texts = [p.get("text", "") for p in passages]

        # 1. Compute BM25 keyword scores
        bm25_scores = self.bm25.score_documents(query, doc_texts)
        for p, b_score in zip(passages, bm25_scores):
            p["bm25_score"] = b_score

        # 2. FlashRank Cross-Encoder Rerank
        ranker = self._get_ranker()
        if ranker is not None:
            try:
                from flashrank import RerankRequest
                flashrank_passages = [
                    {"id": str(i), "text": p.get("text", ""), "meta": p}
                    for i, p in enumerate(passages)
                ]
                req = RerankRequest(query=query, passages=flashrank_passages)
                results = ranker.rerank(req)

                ranked_passages = []
                for res in results:
                    orig_p = passages[int(res["id"])]
                    ce_score = float(res.get("score", 0.0))
                    bm25_boost = float(orig_p.get("bm25_score", 0.0))
                    dense_score = float(orig_p.get("dense_score", 0.5))

                    # True Hybrid Tri-Fusion (CIT-05):
                    # Combines Cross-Encoder precision, Dense semantic similarity (gemini-embedding-2),
                    # and BM25 sparse keyword coverage.
                    hybrid_score = (0.35 * dense_score) + (0.35 * bm25_boost) + (0.30 * ce_score)

                    # If strong cross-encoder score exists, elevate it:
                    if ce_score >= 0.40:
                        hybrid_score = max(hybrid_score, (0.70 * ce_score) + (0.30 * bm25_boost))

                    # Protect against TinyBERT cross-encoder calibration collapse on dense semantic matches:
                    if dense_score >= 0.50:
                        hybrid_score = max(hybrid_score, dense_score * 0.85)

                    # Protect against TinyBERT collapse when strong BM25 keyword matches exist:
                    if bm25_boost >= 0.30:
                        hybrid_score = max(hybrid_score, 0.42 + (0.45 * bm25_boost))

                    # If strong dense semantic match and keyword match both exist:
                    if dense_score >= 0.50 and bm25_boost >= 0.20:
                        hybrid_score = max(hybrid_score, (0.50 * dense_score) + (0.50 * bm25_boost))

                    orig_p["score"] = round(hybrid_score, 4)
                    ranked_passages.append(orig_p)

                # Sort by final score descending
                ranked_passages.sort(key=lambda x: x["score"], reverse=True)
                top_passages = ranked_passages[:top_k]
            except Exception as e:
                logger.warning(f"[FLASHRANK_RERANK_ERR] FlashRank error: {e}. Falling back to hybrid fusion.")
                top_passages = self._fallback_fusion(passages, bm25_scores, top_k)
        else:
            top_passages = self._fallback_fusion(passages, bm25_scores, top_k)

        # 3. Refusal Guard Evaluation (CIT-04)
        top_score = top_passages[0]["score"] if top_passages else 0.0
        refusal_triggered = top_score < self.refusal_threshold

        for idx, p in enumerate(top_passages, 1):
            p["rank"] = idx

        return top_passages, refusal_triggered

    def _fallback_fusion(
        self,
        passages: List[Dict[str, Any]],
        bm25_scores: List[float],
        top_k: int,
    ) -> List[Dict[str, Any]]:
        """
        Lightweight hybrid score fusion when FlashRank model is offline.
        """
        ranked = []
        for p, b_score in zip(passages, bm25_scores):
            dense_score = float(p.get("dense_score", p.get("score", 0.5)))
            # Hybrid fusion: 60% dense + 40% BM25
            score = (0.6 * dense_score) + (0.4 * b_score)
            p_copy = dict(p)
            p_copy["score"] = round(score, 4)
            ranked.append(p_copy)

        ranked.sort(key=lambda x: x["score"], reverse=True)
        return ranked[:top_k]


# Global instance
_rerank_service: Optional[RerankService] = None


def get_rerank_service() -> RerankService:
    global _rerank_service
    if _rerank_service is None:
        _rerank_service = RerankService()
    return _rerank_service
