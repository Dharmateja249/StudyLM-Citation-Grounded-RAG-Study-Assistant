'use client';

import React from 'react';
import { Upload, ArrowUp, FileText, CheckCircle2, Search, ArrowRight } from 'lucide-react';

export function HowItWorksSection() {
  return (
    <section
      role="region"
      aria-label="How It Works"
      id="how-it-works"
      data-testid="landing-how-it-works-section"
      className="py-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto scroll-mt-20"
    >
      {/* Section Header */}
      <div className="text-center max-w-3xl mx-auto mb-16">
        <span className="text-xs font-semibold uppercase tracking-wider text-[#8B83FF] block mb-3">
          HOW IT WORKS
        </span>
        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-[#F3F4F6] mb-4">
          From source material to a clearer answer.
        </h2>
        <p className="text-base sm:text-lg text-[#A1A6B3]">
          A simple workflow that keeps the original evidence close.
        </p>
      </div>

      {/* 3 Step Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* Step 01 */}
        <div className="rounded-2xl bg-[#111318] border border-[#30343E] p-6 sm:p-8 flex flex-col justify-between hover:border-[#8B83FF]/40 transition-colors">
          <div>
            <div className="flex items-center justify-between mb-6">
              <span className="text-2xl font-mono font-bold text-[#8B83FF]">01</span>
              <div className="w-9 h-9 rounded-lg bg-[#242238] border border-[#30343E] flex items-center justify-center text-[#8B83FF]">
                <Upload className="w-5 h-5" />
              </div>
            </div>
            <h3 className="text-xl font-semibold text-[#F3F4F6] mb-3">
              Bring your sources
            </h3>
            <p className="text-sm text-[#A1A6B3] leading-relaxed mb-6">
              Create a notebook for your course or research question. Add documents, notes, books, and lecture links.
            </p>
          </div>

          {/* Card Mockup: Upload Tray */}
          <div className="rounded-xl bg-[#191C23] border border-[#30343E] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <FileText className="w-4 h-4 text-[#8B83FF]" />
                <span className="text-xs font-medium text-[#F3F4F6]">Memory &amp; Learning.pdf</span>
              </div>
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-[11px] text-[#737B8C]">24 pages · Added to notebook</div>
            {/* Progress Bar */}
            <div className="w-full bg-[#111318] h-1.5 rounded-full overflow-hidden">
              <div className="bg-[#8B83FF] h-full w-full rounded-full" />
            </div>
            <div className="text-[11px] text-[#A1A6B3] flex items-center justify-between pt-1">
              <span>4 sources ready to explore</span>
              <span className="text-emerald-400 font-mono">100%</span>
            </div>
          </div>
        </div>

        {/* Step 02 */}
        <div className="rounded-2xl bg-[#111318] border border-[#30343E] p-6 sm:p-8 flex flex-col justify-between hover:border-[#8B83FF]/40 transition-colors">
          <div>
            <div className="flex items-center justify-between mb-6">
              <span className="text-2xl font-mono font-bold text-[#8B83FF]">02</span>
              <div className="w-9 h-9 rounded-lg bg-[#242238] border border-[#30343E] flex items-center justify-center text-[#8B83FF]">
                <Search className="w-5 h-5" />
              </div>
            </div>
            <h3 className="text-xl font-semibold text-[#F3F4F6] mb-3">
              Ask in your own words
            </h3>
            <p className="text-sm text-[#A1A6B3] leading-relaxed mb-6">
              Explore a concept, compare explanations, or follow a question across the sources you choose.
            </p>
          </div>

          {/* Card Mockup: Query Input */}
          <div className="rounded-xl bg-[#191C23] border border-[#30343E] p-4 space-y-3">
            <span className="text-[10px] font-mono tracking-wider uppercase text-[#737B8C] block">
              ASK YOUR SOURCES
            </span>
            <div className="relative">
              <div className="w-full bg-[#111318] border border-[#30343E] rounded-lg px-3 py-2.5 text-xs text-[#F3F4F6] pr-9 font-medium">
                How is retrieval different from rereading?
              </div>
              <button
                type="button"
                aria-label="Send query"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-md bg-[#8B83FF] text-[#191C23] flex items-center justify-center"
              >
                <ArrowUp className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="text-[11px] text-[#737B8C] flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span>Grounded in 3 active sources</span>
            </div>
          </div>
        </div>

        {/* Step 03 */}
        <div className="rounded-2xl bg-[#111318] border border-[#30343E] p-6 sm:p-8 flex flex-col justify-between hover:border-[#8B83FF]/40 transition-colors">
          <div>
            <div className="flex items-center justify-between mb-6">
              <span className="text-2xl font-mono font-bold text-[#8B83FF]">03</span>
              <div className="w-9 h-9 rounded-lg bg-[#242238] border border-[#30343E] flex items-center justify-center text-[#8B83FF]">
                <FileText className="w-5 h-5" />
              </div>
            </div>
            <h3 className="text-xl font-semibold text-[#F3F4F6] mb-3">
              Follow the evidence
            </h3>
            <p className="text-sm text-[#A1A6B3] leading-relaxed mb-6">
              Select a citation to inspect the original passage. Keep reading with the claim in context.
            </p>
          </div>

          {/* Card Mockup: Citation Quote */}
          <div className="rounded-xl bg-[#191C23] border border-[#30343E] p-4 space-y-2.5">
            <div className="flex items-center gap-2">
              <span className="w-5 h-5 rounded bg-[#8B83FF] text-[#191C23] text-xs font-bold flex items-center justify-center">
                1
              </span>
              <span className="text-xs font-medium text-[#F3F4F6]">
                Memory &amp; Learning.pdf · p. 12
              </span>
            </div>
            <div className="p-2.5 rounded bg-[#8B83FF]/10 border-l-2 border-[#8B83FF] text-[12px] text-[#F3F4F6] italic leading-relaxed">
              “Actively retrieving information from memory improves retention…”
            </div>
            <div className="text-[11px] text-[#737B8C] flex items-center justify-between pt-1">
              <span>Coordinate highlight verified</span>
              <span className="text-[#8B83FF] text-[11px] font-medium flex items-center gap-0.5">
                Inspect <ArrowRight className="w-3 h-3" />
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
