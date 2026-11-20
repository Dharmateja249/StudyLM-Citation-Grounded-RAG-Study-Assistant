'use client';

import React from 'react';
import { ArrowRight, Sparkles } from 'lucide-react';

export interface CtaBannerSectionProps {
  onGetStarted?: () => void;
}

export function CtaBannerSection({ onGetStarted }: CtaBannerSectionProps) {
  return (
    <section
      role="region"
      aria-label="Call to Action"
      id="cta"
      data-testid="landing-cta-section"
      className="py-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto"
    >
      <div className="relative rounded-3xl bg-gradient-to-b from-[#111318] to-[#191C23] border border-[#30343E] p-8 sm:p-14 text-center overflow-hidden shadow-2xl">
        {/* Subtle Background Glow */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-[#8B83FF]/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 max-w-2xl mx-auto space-y-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#242238] border border-[#30343E] text-[11px] font-mono tracking-wider uppercase text-[#8B83FF]">
            <Sparkles className="w-3.5 h-3.5" />
            <span>START WITH ONE QUESTION</span>
          </div>

          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-[#F3F4F6] leading-tight">
            Your next insight is already <br className="hidden sm:inline" />
            in your sources.
          </h2>

          <p className="text-base sm:text-lg text-[#A1A6B3] max-w-xl mx-auto">
            Bring them together. Create your first StudyLM notebook.
          </p>

          <div className="pt-2">
            <button
              type="button"
              data-testid="cta-banner-btn"
              onClick={onGetStarted}
              className="inline-flex items-center gap-2 px-7 py-3.5 rounded-full font-medium bg-[#8B83FF] text-[#191C23] hover:bg-[#7A72F0] transition-colors shadow-lg shadow-[#8B83FF]/25 cursor-pointer text-base"
            >
              <span data-testid="cta-get-started-btn">Get started with StudyLM →</span>
            </button>
          </div>

          <div className="pt-4 text-xs font-mono text-[#737B8C] tracking-widest uppercase">
            Upload &rarr; Ask &rarr; Inspect
          </div>
        </div>
      </div>
    </section>
  );
}
