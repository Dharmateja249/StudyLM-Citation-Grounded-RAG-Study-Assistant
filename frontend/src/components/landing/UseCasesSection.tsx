'use client';

import React from 'react';
import { GraduationCap, FlaskConical, ArrowUpRight } from 'lucide-react';

export function UseCasesSection() {
  return (
    <section
      role="region"
      aria-label="Use Cases"
      id="use-cases"
      data-testid="landing-use-cases-section"
      className="py-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto scroll-mt-20"
    >
      {/* Section Header */}
      <div className="text-center max-w-3xl mx-auto mb-16">
        <span className="text-xs font-semibold uppercase tracking-wider text-[#8B83FF] block mb-3">
          USE CASES
        </span>
        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-[#F3F4F6] mb-4">
          For the questions worth spending time on.
        </h2>
        <p className="text-base sm:text-lg text-[#A1A6B3]">
          Whether you’re learning a subject or advancing one, keep your thinking grounded.
        </p>
      </div>

      {/* Dual Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* For Students Card */}
        <div className="rounded-2xl bg-[#111318] border border-[#30343E] p-7 sm:p-9 flex flex-col justify-between hover:border-[#8B83FF]/40 transition-colors">
          <div>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-[#242238] border border-[#30343E] flex items-center justify-center text-[#8B83FF]">
                <GraduationCap className="w-5 h-5" />
              </div>
              <span className="text-xs font-semibold uppercase tracking-wider text-[#8B83FF]">
                FOR STUDENTS
              </span>
            </div>

            <h3 className="text-2xl font-bold text-[#F3F4F6] mb-3">
              Understand it. Don&apos;t just reread it.
            </h3>
            <p className="text-sm text-[#A1A6B3] leading-relaxed mb-8">
              Bring your course material together, work through difficult ideas, and return to the explanation when you need it.
            </p>

            {/* Inner Mockup Box */}
            <div className="rounded-xl bg-[#191C23] border border-[#30343E] p-5 space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-[#30343E]/60 text-xs">
                <span className="font-semibold text-[#F3F4F6]">
                  Cognitive psychology · Exam preparation
                </span>
                <span className="text-[#737B8C]">Course Notebook</span>
              </div>
              <div className="text-xs text-[#737B8C]">
                Lecture notes + reference book + YouTube lectures
              </div>

              {/* Sample Prompts */}
              <div className="space-y-2 pt-2">
                <div className="group flex items-center justify-between p-3 rounded-lg bg-[#111318] border border-[#30343E] text-xs text-[#F3F4F6] hover:border-[#8B83FF]/50 transition-colors cursor-pointer">
                  <span>Explain retrieval practice using my lecture notes.</span>
                  <ArrowUpRight className="w-4 h-4 text-[#8B83FF] opacity-75 group-hover:opacity-100" />
                </div>
                <div className="group flex items-center justify-between p-3 rounded-lg bg-[#111318] border border-[#30343E] text-xs text-[#F3F4F6] hover:border-[#8B83FF]/50 transition-colors cursor-pointer">
                  <span>What am I missing in my explanation of memory?</span>
                  <ArrowUpRight className="w-4 h-4 text-[#8B83FF] opacity-75 group-hover:opacity-100" />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* For Researchers Card */}
        <div className="rounded-2xl bg-[#111318] border border-[#30343E] p-7 sm:p-9 flex flex-col justify-between hover:border-[#8B83FF]/40 transition-colors">
          <div>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-[#242238] border border-[#30343E] flex items-center justify-center text-[#8B83FF]">
                <FlaskConical className="w-5 h-5" />
              </div>
              <span className="text-xs font-semibold uppercase tracking-wider text-[#8B83FF]">
                FOR RESEARCHERS
              </span>
            </div>

            <h3 className="text-2xl font-bold text-[#F3F4F6] mb-3">
              Read across sources. Think critically.
            </h3>
            <p className="text-sm text-[#A1A6B3] leading-relaxed mb-8">
              Compare arguments across a reading list, surface differences, and inspect the passages before drawing a conclusion.
            </p>

            {/* Inner Mockup Box */}
            <div className="rounded-xl bg-[#191C23] border border-[#30343E] p-5 space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-[#30343E]/60 text-xs">
                <span className="font-semibold text-[#F3F4F6]">
                  Learning science · Literature review
                </span>
                <span className="text-[#737B8C]">Research Project</span>
              </div>
              <div className="text-xs text-[#737B8C]">
                Research papers + book chapters + reading notes
              </div>

              {/* Sample Prompts */}
              <div className="space-y-2 pt-2">
                <div className="group flex items-center justify-between p-3 rounded-lg bg-[#111318] border border-[#30343E] text-xs text-[#F3F4F6] hover:border-[#8B83FF]/50 transition-colors cursor-pointer">
                  <span>Where do these sources agree about retention?</span>
                  <ArrowUpRight className="w-4 h-4 text-[#8B83FF] opacity-75 group-hover:opacity-100" />
                </div>
                <div className="group flex items-center justify-between p-3 rounded-lg bg-[#111318] border border-[#30343E] text-xs text-[#F3F4F6] hover:border-[#8B83FF]/50 transition-colors cursor-pointer">
                  <span>Which claims are supported by these papers?</span>
                  <ArrowUpRight className="w-4 h-4 text-[#8B83FF] opacity-75 group-hover:opacity-100" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
