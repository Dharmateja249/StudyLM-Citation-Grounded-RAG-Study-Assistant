"""
StudyLM Intent Router, Query Rewriter & Prompt Sanitizer.
File: backend/app/services/intent_router.py

Implements:
- Intent classification: Search, Chitchat, Summarization (CIT-04).
  * Fails toward retrieval when unsure.
  * Chitchat path bypasses retrieval refusal threshold.
- Conversational query rewriting for multi-turn follow-ups (CIT-06).
- Prompt injection delimiter sanitization and title quote escaping (CIT-07).
"""

from __future__ import annotations

import logging
import re
from typing import Any, Dict, List, Optional

logger = logging.getLogger("studylm.intent_router")

# Conversational chitchat regex patterns
CHITCHAT_PATTERNS = [
    r"^(?:hi|hello|hey|good\s+(?:morning|afternoon|evening)|howdy)\b",
    r"^(?:thanks|thank\s+you|thx|cheers)\b",
    r"^(?:who\s+are\s+you|what\s+is\s+your\s+name|what\s+can\s+you\s+do)\b",
    r"^(?:bye|goodbye|see\s+you|have\s+a\s+good\s+day)\b",
]

# Summarization intent triggers
SUMMARIZE_PATTERNS = [
    r"\b(?:summarize|summary|overview|synopsis|recap|outline|convey|key\s+takeaways|main\s+points|main\s+topics|table\s+of\s+contents)\b",
    r"\bwhat\s+(?:does\s+the\s+notes|do\s+the\s+notes|does\s+this\s+(?:document|pdf|file))\s+convey\b",
    r"\bwhat\s+is\s+this\s+(?:document|notes|file|pdf|material|paper)\s+about\b",
]

# Prompt injection delimiters to strip
INJECTION_DELIMITERS = [
    r"---\s*(?:END|START)\s+OF\s+CONTEXT\s*---",
    r"===\s*SYSTEM(?:\s+PROMPT)?\s*===",
    r"<<<\s*SYSTEM\s*>>>",
    r"\[\[\s*SYSTEM\s*\]\]",
    r"(?i)ignore\s+(?:all\s+)?previous\s+instructions",
    r"(?i)disregard\s+(?:all\s+)?prior\s+guidelines",
    r"(?i)you\s+are\s+now\s+in\s+unrestricted\s+mode",
]


class IntentRouter:
    """
    Classifies incoming user messages into intents:
    - 'search': Knowledge queries requiring grounded retrieval (default safe path).
    - 'chitchat': Conversational greetings / pleasantries (bypasses retrieval refusal).
    - 'summarize': Source or notebook summarization requests.
    """

    def classify_intent(self, query: str) -> str:
        clean_q = query.strip().lower()

        # Check for Chitchat
        for pattern in CHITCHAT_PATTERNS:
            if re.search(pattern, clean_q, re.IGNORECASE):
                # Ensure it's not a compound question like "Hello, what is Newton's law?"
                words = clean_q.split()
                if len(words) <= 6:
                    return "chitchat"

        # Check for Summarization
        for pattern in SUMMARIZE_PATTERNS:
            if re.search(pattern, clean_q, re.IGNORECASE):
                return "summarize"

        # Default: Fail toward retrieval
        return "search"


class QueryRewriter:
    """
    CIT-06: Rewrites contextual follow-up questions into standalone search queries.
    Example:
      History: "User: Who formulated the laws of motion? Assistant: Sir Isaac Newton."
      Query: "What was his second law?"
      Rewritten: "What was Isaac Newton's second law of motion?"
    """

    def rewrite_query(self, query: str, conversation_history: List[Dict[str, str]]) -> str:
        if not conversation_history:
            return query

        clean_q = query.strip()
        lower_q = clean_q.lower()

        # Check for pronoun / referential follow-up triggers
        referential_triggers = [
            r"\bhis\b", r"\bher\b", r"\bits\b", r"\btheir\b",
            r"\bhe\b", r"\bshe\b", r"\bit\b", r"\bthey\b",
            r"\bthat\b", r"\bthis\b", r"\bthe\s+second\b", r"\bthe\s+third\b",
            r"\bthe\s+former\b", r"\bthe\s+latter\b",
        ]

        has_reference = any(re.search(pat, lower_q) for pat in referential_triggers)
        if not has_reference:
            return clean_q

        # Extract last context topic from previous assistant / user messages
        last_context = ""
        for msg in reversed(conversation_history):
            content = msg.get("content", "")
            if content:
                last_context = content
                break

        if not last_context:
            return clean_q

        # Lightweight rule-based resolution
        # Identify key subject in context
        subject_match = re.search(r"\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b", last_context)
        subject = subject_match.group(1) if subject_match else ""

        if subject:
            # Replace possessive pronouns: his, her, its -> Subject's
            rewritten = re.sub(r"\b(?:his|her|its|their)\b", f"{subject}'s", clean_q, flags=re.IGNORECASE)
            # Replace direct pronouns: he, she, it -> Subject
            rewritten = re.sub(r"\b(?:he|she|it|they)\b", subject, rewritten, flags=re.IGNORECASE)
            return rewritten

        return clean_q


class PromptSanitizer:
    """
    CIT-07: Sanitizes user inputs and source metadata against prompt injection attacks.
    - Strips delimiter tokens designed to break out of system boundaries.
    - Escapes quotes in source title injections: title="..."
    """

    def sanitize_user_input(self, text: str) -> str:
        sanitized = text
        for pattern in INJECTION_DELIMITERS:
            sanitized = re.sub(pattern, "[SANITIZED_DELIMITER]", sanitized)
        return sanitized.strip()

    def escape_title(self, title: str) -> str:
        """
        Escapes double quotes in source titles for safe injection inside title="..." prompts.
        """
        if not title:
            return ""
        # Escape backslashes first, then double quotes
        escaped = title.replace("\\", "\\\\").replace('"', '\\"')
        return escaped

    def format_source_prompt_chunk(
        self,
        alias: str,
        title: str,
        page: Optional[int],
        text: str,
        start_seconds: Optional[float] = None,
    ) -> str:
        """
        Formats a grounded source chunk header safely with escaped title quotes and optional page/timestamp metadata.
        """
        safe_title = self.escape_title(title)
        meta_parts = [f'alias="{alias}"', f'title="{safe_title}"']
        if page is not None:
            meta_parts.append(f'page={page}')
        if start_seconds is not None:
            mins = int(start_seconds // 60)
            secs = int(start_seconds % 60)
            meta_parts.append(f'timestamp="{mins:02d}:{secs:02d}"')
        header = " ".join(meta_parts)
        return f'<{header}>\n{text}\n</source>'
