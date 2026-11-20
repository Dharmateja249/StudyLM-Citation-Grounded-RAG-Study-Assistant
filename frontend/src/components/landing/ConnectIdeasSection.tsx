'use client';

import React from 'react';
import { FileText, Play, Sparkles } from 'lucide-react';

export function ConnectIdeasSection() {
  return (
    <section
      role="region"
      aria-label="Connect Ideas"
      id="connect-ideas"
      data-testid="landing-connect-ideas-section"
      className="py-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto scroll-mt-20"
    >
      {/* Section Header */}
      <div className="text-center max-w-3xl mx-auto mb-16">
        <span className="text-xs font-semibold uppercase tracking-wider text-[#8B83FF] block mb-3">
          CONNECT THE IDEAS
        </span>
        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-[#F3F4F6] mb-4">
          A clearer view. Across every source.
        </h2>
        <p className="text-base sm:text-lg text-[#A1A6B3]">
          One paper gives you an argument. A connected reading list gives you perspective. Ask StudyLM to compare sources without losing the trail back to each one.
        </p>
      </div>

      {/* Main Synthesis Component */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left: Try Asking Card */}
        <div className="lg:col-span-5 rounded-2xl bg-[#111318] border border-[#30343E] p-6 sm:p-8 space-y-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#242238] border border-[#30343E] text-[11px] font-mono tracking-wider uppercase text-[#8B83FF]">
            <Sparkles className="w-3.5 h-3.5" />
            <span>TRY ASKING</span>
          </div>

          <blockquote className="text-xl sm:text-2xl font-medium text-[#F3F4F6] leading-snug">
            “How do my sources explain the difference between familiarity and recall?”
          </blockquote>

          <p className="text-sm text-[#A1A6B3] leading-relaxed">
            StudyLM reads across your uploaded papers, textbooks, and video lectures simultaneously, pulling together relevant passages and synthesizing a unified answer with citations back to every claim.
          </p>

          <div className="pt-4 border-t border-[#30343E] flex items-center gap-3 text-xs text-[#737B8C]">
            <span className="w-2 h-2 rounded-full bg-[#8B83FF]" />
            <span>Multi-document synthesis enabled</span>
          </div>
        </div>

        {/* Right: Synthesis Inspector Card */}
        <div className="lg:col-span-7 rounded-2xl bg-[#111318] border border-[#30343E] p-6 sm:p-8 space-y-5 shadow-xl">
          <div className="flex items-center justify-between pb-4 border-b border-[#30343E]">
            <h3 className="text-base font-semibold text-[#F3F4F6]">
              A view across your sources
            </h3>
            <span className="text-xs font-mono text-[#8B83FF] px-2.5 py-1 rounded-full bg-[#242238] border border-[#30343E]">
              3 sources
            </span>
          </div>

          {/* 3 Source Passages */}
          <div className="space-y-3">
            {/* Source 1 */}
            <div className="p-4 rounded-xl bg-[#191C23] border border-[#30343E] flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-xs font-medium text-[#F3F4F6]">
                  <FileText className="w-3.5 h-3.5 text-[#8B83FF]" />
                  <span>Memory &amp; Learning.pdf</span>
                  <span className="text-[#737B8C]">· Page 12</span>
                </div>
                <p className="text-xs text-[#A1A6B3] leading-relaxed">
                  Active recall improves later retention more than repeated study.
                </p>
              </div>
              <span className="w-6 h-6 rounded bg-[#242238] text-[#8B83FF] text-xs font-bold flex items-center justify-center shrink-0 border border-[#30343E]">
                1
              </span>
            </div>

            {/* Source 2 */}
            <div className="p-4 rounded-xl bg-[#191C23] border border-[#30343E] flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-xs font-medium text-[#F3F4F6]">
                  <FileText className="w-3.5 h-3.5 text-[#8B83FF]" />
                  <span>Cognitive Psychology</span>
                  <span className="text-[#737B8C]">· Chapter 6</span>
                </div>
                <p className="text-xs text-[#A1A6B3] leading-relaxed">
                  Familiarity with a text is different from being able to recall it.
                </p>
              </div>
              <span className="w-6 h-6 rounded bg-[#242238] text-[#8B83FF] text-xs font-bold flex items-center justify-center shrink-0 border border-[#30343E]">
                2
              </span>
            </div>

            {/* Source 3 */}
            <div className="p-4 rounded-xl bg-[#191C23] border border-[#30343E] flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-xs font-medium text-[#F3F4F6]">
                  <Play className="w-3.5 h-3.5 text-[#8B83FF]" />
                  <span>Retrieval practice</span>
                  <span className="text-[#737B8C]">· YouTube lecture · 18:42</span>
                </div>
                <p className="text-xs text-[#A1A6B3] leading-relaxed">
                  Use feedback to correct gaps after an attempt to recall.
                </p>
              </div>
              <span className="w-6 h-6 rounded bg-[#242238] text-[#8B83FF] text-xs font-bold flex items-center justify-center shrink-0 border border-[#30343E]">
                3
              </span>
            </div>
          </div>

          {/* The Connection Callout */}
          <div className="p-5 rounded-xl bg-[#8B83FF]/10 border-l-4 border-[#8B83FF] space-y-1.5 mt-6">
            <div className="text-xs font-semibold uppercase tracking-wider text-[#8B83FF]">
              The connection
            </div>
            <p className="text-sm font-medium text-[#F3F4F6] leading-relaxed">
              Knowing something feels familiar is not the same as recalling it. Practice recall, then check your answer against the material.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
