'use client';

/**
 * Grounded Markdown Renderer
 * File: frontend/src/components/chat/GroundedMarkdown.tsx
 *
 * Implements:
 * - Replacement of [[cite:N]] markers with interactive <CitationChip /> pills
 * - Rendering of [Citation Unverified] warning badges without throwing or crashing
 * - Safe AST tokenization preventing XSS and preserving code/bold formatting
 */

import React, { useMemo } from 'react';
import { ResolvedCitation } from '@/types/api';
import { CitationChip } from './CitationChip';
import { AlertTriangle } from 'lucide-react';

export interface GroundedMarkdownProps {
  content: string;
  citations?: ResolvedCitation[] | Record<number, ResolvedCitation>;
  className?: string;
}

export function GroundedMarkdown({
  content,
  citations,
  className = '',
}: GroundedMarkdownProps) {
  const citationMap = useMemo(() => {
    const map = new Map<number, ResolvedCitation>();
    if (Array.isArray(citations)) {
      for (const c of citations) {
        map.set(c.marker_id, c);
      }
    } else if (citations && typeof citations === 'object') {
      for (const [key, val] of Object.entries(citations)) {
        map.set(Number(key), val as ResolvedCitation);
      }
    }
    return map;
  }, [citations]);

  // Tokenize string into components: [[cite:N]], [Citation Unverified], **bold**, `code`, \n\n
  const renderedContent = useMemo(() => {
    if (!content) return null;

    // Pattern matching citation tokens, unverified warnings, bold, code, and double newlines
    const regex = /(\[\[cite:\d+\]\]|\[Citation Unverified\]|\[\[cite:unverified\]\]|\*\*.*?\*\*|`.*?`|\n\n|\n)/g;
    const parts = content.split(regex);

    return parts.map((part, index) => {
      if (!part) return null;

      // 1. Citation Marker: [[cite:N]]
      const citeMatch = part.match(/^\[\[cite:(\d+)\]\]$/);
      if (citeMatch) {
        const markerId = parseInt(citeMatch[1], 10);
        const resolvedCitation = citationMap.get(markerId);
        return (
          <CitationChip
            key={`cite-${markerId}-${index}`}
            markerId={markerId}
            citation={resolvedCitation}
          />
        );
      }

      // 2. Unverified Citation Warning Badge
      if (part === '[Citation Unverified]' || part === '[[cite:unverified]]') {
        return (
          <span
            key={`unverified-${index}`}
            data-testid="unverified-citation-badge"
            className="inline-flex items-center gap-1 px-1.5 py-0.5 mx-1 text-xs font-medium rounded border border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 cursor-help"
            title="Citation not found in source notes"
            aria-label="Citation Unverified: Citation not found in source notes"
          >
            <AlertTriangle className="w-3 h-3 text-amber-500 inline" />
            <span>[Citation Unverified]</span>
          </span>
        );
      }

      // 3. Bold: **text**
      if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
        return (
          <strong key={`bold-${index}`} className="font-semibold text-foreground">
            {part.slice(2, -2)}
          </strong>
        );
      }

      // 4. Inline Code: `code`
      if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
        return (
          <code
            key={`code-${index}`}
            className="px-1 py-0.5 rounded bg-muted font-mono text-xs text-foreground"
          >
            {part.slice(1, -1)}
          </code>
        );
      }

      // 5. Paragraph Break: \n\n
      if (part === '\n\n') {
        return <div key={`p-break-${index}`} className="h-3" />;
      }

      // 6. Line Break: \n
      if (part === '\n') {
        return <br key={`br-${index}`} />;
      }

      // Plain Text
      return <span key={`text-${index}`}>{part}</span>;
    });
  }, [content, citationMap]);

  return (
    <div
      data-testid="grounded-markdown"
      className={`prose prose-sm dark:prose-invert max-w-none text-foreground leading-relaxed ${className}`}
    >
      {renderedContent}
    </div>
  );
}
