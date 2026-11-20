'use client';

import React, { useState } from 'react';
import { ArrowRight, BookOpen, Clock, FileText, CheckCircle2, ChevronLeft, ChevronRight, Play } from 'lucide-react';

export interface HeroSectionProps {
  onGetStarted?: () => void;
  onExploreDemo?: () => void;
  defaultCitation?: 1 | 2 | 3;
}

interface CitationItem {
  id: 1 | 2 | 3;
  sourceTitle: string;
  subhead: string;
  section: string;
  contextBefore: string;
  activeQuote: string;
  contextAfter: string;
  label: string;
  counter: string;
  badge: string;
  type: 'pdf' | 'video';
}

const CITATION_DATA: Record<1 | 2 | 3, CitationItem> = {
  1: {
    id: 1,
    sourceTitle: 'Memory & Learning.pdf',
    subhead: 'Chapter 3 · Retrieval practice · Page 12 of 24',
    section: '3.2 RETRIEVAL AS A LEARNING EVENT',
    contextBefore:
      'Repeated study can increase familiarity with a text. That feeling, however, does not necessarily indicate that the information can be recalled later.',
    activeQuote:
      '“Actively retrieving information from memory improves retention on a later test more than repeated study.”',
    contextAfter:
      'The important distinction is between recognizing an explanation and producing it without the source in view.',
    label: 'PASSAGE REFERENCED BY CITATION 1',
    counter: 'Evidence 1 of 3',
    badge: '12 / 24',
    type: 'pdf',
  },
  2: {
    id: 2,
    sourceTitle: 'Cognitive Psychology.pdf',
    subhead: 'Chapter 6 · Familiarity vs Recall · Page 48 of 120',
    section: '6.1 RECOGNITION VERSUS PRODUCTION',
    contextBefore:
      'Students often conflate fluent reading with actual mastery of underlying mechanisms. Recognition memory relies on familiarity signals, whereas recall requires direct retrieval pathways.',
    activeQuote:
      '“Familiarity with a text is different from being able to recall it.”',
    contextAfter:
      'Testing forces direct retrieval paths, differentiating passive familiarity from durable comprehension.',
    label: 'PASSAGE REFERENCED BY CITATION 2',
    counter: 'Evidence 2 of 3',
    badge: '48 / 120',
    type: 'pdf',
  },
  3: {
    id: 3,
    sourceTitle: 'Retrieval practice',
    subhead: 'YouTube lecture · 18:42',
    section: 'LECTURE TIMESTAMP 18:42 — FEEDBACK LOOPS',
    contextBefore:
      'Without immediate targeted feedback, retrieval attempts risk reinforcing misconceptions. During active testing, immediate feedback identifies misconception boundaries.',
    activeQuote:
      '“Feedback then helps you correct what you missed before the next attempt. Use feedback to correct gaps after an attempt to recall.”',
    contextAfter:
      'Re-evaluating the source material immediately after recall locks in verified corrections.',
    label: 'PASSAGE REFERENCED BY CITATION 3',
    counter: 'Evidence 3 of 3',
    badge: '18:42',
    type: 'video',
  },
};

export function HeroSection({
  onGetStarted,
  onExploreDemo,
  defaultCitation = 1,
}: HeroSectionProps) {
  const [activeCitation, setActiveCitation] = useState<1 | 2 | 3>(defaultCitation);

  const currentCitation = CITATION_DATA[activeCitation] || CITATION_DATA[1];

  const handleCitationClick = (id: 1 | 2 | 3) => {
    setActiveCitation(id);
  };

  return (
    <section
      role="region"
      aria-label="Hero Section"
      id="hero"
      data-testid="landing-hero-section"
      className="relative pt-12 pb-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto"
    >
      {/* Overline & Main Headline */}
      <div className="text-center max-w-3xl mx-auto mb-12">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#242238] border border-[#30343E] mb-6">
          <span className="w-2 h-2 rounded-full bg-[#8B83FF]" />
          <span className="text-xs font-semibold uppercase tracking-wider text-[#8B83FF]">
            EVIDENCE, NOT JUST ANSWERS
          </span>
        </div>

        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-[#F3F4F6] leading-[1.15] mb-6">
          A citation is a starting point. <br className="hidden sm:inline" />
          <span className="text-[#A1A6B3]">Not a footnote.</span>
        </h1>

        <p className="text-lg sm:text-xl text-[#A1A6B3] max-w-2xl mx-auto leading-relaxed mb-8">
          Move from an answer to the passage behind it. Check what was said, where it came from, and whether the context supports the claim.
        </p>

        {/* CTA Buttons */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <button
            type="button"
            data-testid="hero-get-started-btn"
            onClick={onGetStarted}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-full font-medium bg-[#8B83FF] text-[#191C23] hover:bg-[#7A72F0] transition-colors shadow-lg shadow-[#8B83FF]/20 cursor-pointer text-base"
          >
            <span>Get started with StudyLM →</span>
          </button>
          <button
            type="button"
            data-testid="hero-explore-demo-btn"
            onClick={onExploreDemo}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-full font-medium border border-[#30343E] bg-[#111318] text-[#F3F4F6] hover:bg-[#242238] hover:border-[#8B83FF]/40 transition-colors cursor-pointer text-base"
          >
            <span>Explore Interactive Demo</span>
          </button>
        </div>
      </div>

      {/* Interactive Illustrative Workspace Preview Card */}
      <div className="relative rounded-2xl bg-[#111318] border border-[#30343E] shadow-2xl overflow-hidden mt-8">
        {/* Card Header Bar */}
        <div className="px-5 py-3 border-b border-[#30343E] bg-[#191C23]/60 flex items-center justify-between text-xs text-[#A1A6B3]">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[#30343E]" />
            <span className="w-2.5 h-2.5 rounded-full bg-[#30343E]" />
            <span className="w-2.5 h-2.5 rounded-full bg-[#30343E]" />
            <span className="ml-2 font-mono text-[#737B8C]">Learning &amp; memory &gt; Inspect evidence</span>
          </div>
          <span className="px-2 py-0.5 rounded text-[10px] font-mono tracking-wider bg-[#242238] text-[#8B83FF] border border-[#30343E]">
            ILLUSTRATIVE WORKSPACE
          </span>
        </div>

        {/* Card Body: 2 Columns */}
        <div className="grid grid-cols-1 lg:grid-cols-12 min-h-[460px]">
          {/* Left Column: Chat Workspace Mockup */}
          <div className="lg:col-span-5 p-6 border-b lg:border-b-0 lg:border-r border-[#30343E] flex flex-col justify-between bg-[#111318]">
            <div className="space-y-5">
              {/* User Prompt */}
              <div className="bg-[#191C23] border border-[#30343E] rounded-xl p-4">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[#737B8C] block mb-1">
                  QUERY
                </span>
                <p className="text-sm font-medium text-[#F3F4F6]">
                  Why does retrieval practice improve long-term memory?
                </p>
              </div>

              {/* Bot Response */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-xs font-semibold text-[#8B83FF]">
                  <span className="w-2 h-2 rounded-full bg-[#8B83FF]" />
                  <span>StudyLM Answer</span>
                </div>

                {/* Paragraph 1 with Citations [1] and [2] */}
                <p className="text-sm text-[#A1A6B3] leading-relaxed">
                  Retrieving an idea is itself a learning event. It strengthens later retention, even when repeated study makes the material feel more familiar.{' '}
                  <button
                    type="button"
                    data-testid="hero-citation-1"
                    aria-label="View Citation 1"
                    onClick={() => handleCitationClick(1)}
                    className={`inline-flex items-center justify-center px-1.5 py-0.5 mx-0.5 text-xs font-semibold rounded cursor-pointer transition-all ${
                      activeCitation === 1
                        ? 'bg-[#8B83FF] text-[#191C23] font-bold shadow-md shadow-[#8B83FF]/30 scale-105'
                        : 'bg-[#242238] text-[#8B83FF] hover:bg-[#8B83FF]/20 border border-[#30343E]'
                    }`}
                  >
                    [1]
                  </button>{' '}
                  <button
                    type="button"
                    data-testid="hero-citation-2"
                    aria-label="View Citation 2"
                    onClick={() => handleCitationClick(2)}
                    className={`inline-flex items-center justify-center px-1.5 py-0.5 mx-0.5 text-xs font-semibold rounded cursor-pointer transition-all ${
                      activeCitation === 2
                        ? 'bg-[#8B83FF] text-[#191C23] font-bold shadow-md shadow-[#8B83FF]/30 scale-105'
                        : 'bg-[#242238] text-[#8B83FF] hover:bg-[#8B83FF]/20 border border-[#30343E]'
                    }`}
                  >
                    [2]
                  </button>
                </p>

                {/* Micro Hint */}
                <div className="text-[11px] text-[#737B8C] italic">
                  Selected citation opens the original passage →
                </div>

                {/* Paragraph 2 with Citation [3] */}
                <p className="text-sm text-[#A1A6B3] leading-relaxed">
                  Feedback then helps you correct what you missed before the next attempt.{' '}
                  <button
                    type="button"
                    data-testid="hero-citation-3"
                    aria-label="View Citation 3"
                    onClick={() => handleCitationClick(3)}
                    className={`inline-flex items-center justify-center px-1.5 py-0.5 mx-0.5 text-xs font-semibold rounded cursor-pointer transition-all ${
                      activeCitation === 3
                        ? 'bg-[#8B83FF] text-[#191C23] font-bold shadow-md shadow-[#8B83FF]/30 scale-105'
                        : 'bg-[#242238] text-[#8B83FF] hover:bg-[#8B83FF]/20 border border-[#30343E]'
                    }`}
                  >
                    [3]
                  </button>
                </p>
              </div>
            </div>

            {/* Micro Citation Switcher Hint Bar */}
            <div className="pt-4 mt-6 border-t border-[#30343E] flex items-center justify-between text-xs text-[#737B8C]">
              <span>Active Evidence:</span>
              <div className="flex items-center gap-1.5">
                {([1, 2, 3] as const).map((id) => (
                  <button
                    key={id}
                    type="button"
                    data-testid={`hero-citation-pill-${id}`}
                    onClick={() => handleCitationClick(id)}
                    className={`w-6 h-6 rounded flex items-center justify-center text-xs font-semibold transition-all ${
                      activeCitation === id
                        ? 'bg-[#8B83FF] text-[#191C23]'
                        : 'bg-[#191C23] text-[#A1A6B3] hover:text-[#F3F4F6] border border-[#30343E]'
                    }`}
                  >
                    {id}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Right Column: Grounded Document Inspector Mockup */}
          <div className="lg:col-span-7 p-6 bg-[#191C23]/40 flex flex-col justify-between">
            <div>
              {/* Document Header */}
              <div className="flex items-start justify-between pb-4 border-b border-[#30343E] mb-5">
                <div>
                  <div className="flex items-center gap-2">
                    {currentCitation.type === 'video' ? (
                      <Play className="w-4 h-4 text-[#8B83FF]" />
                    ) : (
                      <FileText className="w-4 h-4 text-[#8B83FF]" />
                    )}
                    <h3
                      data-testid="hero-inspector-source"
                      className="text-base font-semibold text-[#F3F4F6]"
                    >
                      {currentCitation.sourceTitle}
                    </h3>
                  </div>
                  <p className="text-xs text-[#737B8C] mt-1">{currentCitation.subhead}</p>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-[#A1A6B3] px-2 py-1 rounded bg-[#111318] border border-[#30343E]">
                    {currentCitation.badge}
                  </span>
                </div>
              </div>

              {/* Document Section Kicker */}
              <div className="text-[11px] font-mono tracking-wider text-[#8B83FF] uppercase mb-3">
                {currentCitation.section}
              </div>

              {/* Context and Highlighted Passage */}
              <div
                data-testid="hero-excerpt-highlight"
                className="space-y-3 text-xs sm:text-sm text-[#A1A6B3] leading-relaxed"
              >
                <p className="text-[#737B8C]">{currentCitation.contextBefore}</p>

                {/* Verified Quote Callout */}
                <div
                  data-testid="hero-active-quote"
                  className="p-4 rounded-xl bg-[#8B83FF]/10 border-l-4 border-[#8B83FF] text-[#F3F4F6] transition-all"
                >
                  <div className="text-[10px] font-mono uppercase tracking-wider text-[#8B83FF] mb-1">
                    {currentCitation.label}
                  </div>
                  <p
                    data-testid="hero-inspector-quote"
                    className="font-medium text-sm sm:text-base leading-relaxed text-[#F3F4F6]"
                  >
                    {currentCitation.activeQuote}
                  </p>
                </div>

                <p className="text-[#737B8C]">{currentCitation.contextAfter}</p>
              </div>
            </div>

            {/* Bottom Evidence Navigation */}
            <div className="pt-4 mt-6 border-t border-[#30343E] flex items-center justify-between text-xs text-[#737B8C]">
              <span>{currentCitation.counter}</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-label="Previous Citation"
                  onClick={() => handleCitationClick(activeCitation === 1 ? 3 : ((activeCitation - 1) as 1 | 2 | 3))}
                  className="p-1 rounded hover:bg-[#242238] text-[#A1A6B3] hover:text-[#F3F4F6] transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  aria-label="Next Citation"
                  onClick={() => handleCitationClick(activeCitation === 3 ? 1 : ((activeCitation + 1) as 1 | 2 | 3))}
                  className="p-1 rounded hover:bg-[#242238] text-[#A1A6B3] hover:text-[#F3F4F6] transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 3 Quick Highlights Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-12">
        <div className="p-5 rounded-xl bg-[#111318] border border-[#30343E] flex items-start gap-4">
          <div className="w-10 h-10 rounded-lg bg-[#242238] border border-[#30343E] flex items-center justify-center shrink-0 text-[#8B83FF]">
            <BookOpen className="w-5 h-5" />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-[#F3F4F6] mb-1">Page-level context</h4>
            <p className="text-xs text-[#A1A6B3] leading-relaxed">
              Inspect the passage in your document. Keep reading with the full surrounding context in view.
            </p>
          </div>
        </div>

        <div className="p-5 rounded-xl bg-[#111318] border border-[#30343E] flex items-start gap-4">
          <div className="w-10 h-10 rounded-lg bg-[#242238] border border-[#30343E] flex items-center justify-center shrink-0 text-[#8B83FF]">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-[#F3F4F6] mb-1">Lecture timestamps</h4>
            <p className="text-xs text-[#A1A6B3] leading-relaxed">
              Return to the moment in a video lecture. Auto-seek to the exact second the idea was taught.
            </p>
          </div>
        </div>

        <div className="p-5 rounded-xl bg-[#111318] border border-[#30343E] flex items-start gap-4">
          <div className="w-10 h-10 rounded-lg bg-[#242238] border border-[#30343E] flex items-center justify-center shrink-0 text-[#8B83FF]">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-[#F3F4F6] mb-1">Multi-source synthesis</h4>
            <p className="text-xs text-[#A1A6B3] leading-relaxed">
              Choose what belongs in the answer. Synthesize claims across multiple papers, books, and notes.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
