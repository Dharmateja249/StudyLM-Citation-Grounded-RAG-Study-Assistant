'use client';

import React from 'react';
import {
  SlidersHorizontal,
  BookOpen,
  GitBranch,
  Play,
  MessageSquare,
  Library,
} from 'lucide-react';

const FEATURES = [
  {
    icon: SlidersHorizontal,
    title: 'Define the scope',
    description:
      'Include the sources that matter. Leave unrelated material out of the conversation.',
    tag: 'SOURCE SCOPE / 3 of 4 selected',
  },
  {
    icon: BookOpen,
    title: 'Compare explanations',
    description:
      'See where your papers, notes, and lectures align—and where their perspectives differ.',
    tag: 'PROMPT / Compare these two arguments',
  },
  {
    icon: GitBranch,
    title: 'Unpack difficult concepts',
    description:
      'Ask for a simpler explanation, then dig into the terms and assumptions behind it.',
    tag: 'FOLLOW-UP / Explain this step by step',
  },
  {
    icon: Play,
    title: 'Revisit the right moment',
    description:
      'Connect a lecture-based answer to the relevant transcript excerpt and video timestamp.',
    tag: 'VIDEO EVIDENCE / Lecture · 18:42',
  },
  {
    icon: MessageSquare,
    title: 'Keep the question going',
    description:
      'Follow a line of inquiry without starting over. Ask what supports a claim or what is missing.',
    tag: 'FOLLOW-UP / What evidence supports that?',
  },
  {
    icon: Library,
    title: 'Organize by how you think',
    description:
      'Separate courses, topics, and research projects into focused notebooks with their own sources.',
    tag: 'NOTEBOOK / Learning & memory',
  },
];

export function FeaturesGridSection() {
  return (
    <section
      role="region"
      aria-label="Features"
      id="features"
      data-testid="landing-features-section"
      className="py-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto scroll-mt-20"
    >
      {/* Section Header */}
      <div className="text-center max-w-3xl mx-auto mb-16">
        <span className="text-xs font-semibold uppercase tracking-wider text-[#8B83FF] block mb-3">
          BUILT FOR DEEPER WORK
        </span>
        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-[#F3F4F6] mb-4">
          Everything stays connected to your material.
        </h2>
        <p className="text-base sm:text-lg text-[#A1A6B3]">
          A focused set of tools for understanding—not another place to lose the thread.
        </p>
      </div>

      {/* 6-Card Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {FEATURES.map((feature) => {
          const Icon = feature.icon;
          return (
            <div
              key={feature.title}
              className="rounded-2xl bg-[#111318] border border-[#30343E] p-6 sm:p-7 flex flex-col justify-between hover:border-[#8B83FF]/40 transition-colors group"
            >
              <div>
                <div className="w-10 h-10 rounded-xl bg-[#242238] border border-[#30343E] flex items-center justify-center text-[#8B83FF] mb-5 group-hover:scale-105 transition-transform">
                  <Icon className="w-5 h-5" />
                </div>
                <h3 className="text-lg font-semibold text-[#F3F4F6] mb-2.5">
                  {feature.title}
                </h3>
                <p className="text-sm text-[#A1A6B3] leading-relaxed mb-6">
                  {feature.description}
                </p>
              </div>

              {/* Tag at bottom */}
              <div className="pt-4 border-t border-[#30343E]/60">
                <span className="inline-block text-[11px] font-mono tracking-wider text-[#8B83FF] bg-[#242238]/60 px-2.5 py-1 rounded border border-[#30343E]">
                  {feature.tag}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
