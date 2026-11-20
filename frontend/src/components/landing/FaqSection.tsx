'use client';

import React, { useState, useRef } from 'react';
import { ChevronDown, Plus, Minus } from 'lucide-react';

interface FaqItem {
  question: string;
  answer: string;
}

const FAQ_ITEMS: FaqItem[] = [
  {
    question: 'How does StudyLM use my sources?',
    answer:
      'StudyLM indexes your uploaded materials—PDFs, lecture notes, reference books, and YouTube lecture links—to create vector embeddings for precise semantic retrieval. When you ask a question, it retrieves only relevant excerpts, ensuring every claim is backed by verbatim evidence from your materials.',
  },
  {
    question: 'How is this different from standard chat AI?',
    answer:
      'Standard chat AIs rely on pre-trained weights and frequently hallucinate plausible-sounding facts. StudyLM strictly grounds its responses in your actual uploaded notes, books, and lectures, providing exact page-level coordinate highlights and auto-seeking video timestamps so you can verify every single statement.',
  },
  {
    question: 'How do citations work?',
    answer:
      'When StudyLM answers, it embeds interactive citation chips like [1], [2], [3] directly inline. Clicking a citation highlights the source document in the viewer, scrolls to the exact sentence bounding box on the PDF page, or seeks the video lecture to the exact timestamp of the quote.',
  },
  {
    question: 'Can I compare multiple sources at once?',
    answer:
      'Yes. You can upload multiple PDFs and YouTube lectures into a single notebook and select all or a subset of them for your query. StudyLM synthesizes information across multiple documents, citing each distinct source with individual numbered references.',
  },
  {
    question: 'How do I know the answers are accurate?',
    answer:
      'Because every answer is accompanied by verified quote cards and bounding box highlights in the original document viewer. If your materials do not contain sufficient evidence to answer a question, StudyLM issues a calibrated refusal rather than guessing.',
  },
];

export function FaqSection() {
  const [openIndices, setOpenIndices] = useState<number[]>([]);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const toggleItem = (index: number) => {
    setOpenIndices((prev) =>
      prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index]
    );
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const total = FAQ_ITEMS.length;
    let nextIndex = index;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      nextIndex = (index + 1) % total;
      buttonRefs.current[nextIndex]?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      nextIndex = (index - 1 + total) % total;
      buttonRefs.current[nextIndex]?.focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      buttonRefs.current[0]?.focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      buttonRefs.current[total - 1]?.focus();
    }
  };

  return (
    <section
      role="region"
      aria-label="Frequently Asked Questions"
      id="faq"
      data-testid="landing-faq-section"
      className="py-20 px-4 sm:px-6 lg:px-8 max-w-4xl mx-auto scroll-mt-20"
    >
      {/* Section Header */}
      <div className="text-center mb-16">
        <span className="text-xs font-semibold uppercase tracking-wider text-[#8B83FF] block mb-3">
          A FEW THINGS TO KNOW
        </span>
        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-[#F3F4F6] mb-4">
          Good questions. Clear answers.
        </h2>
        <p className="text-base sm:text-lg text-[#A1A6B3]">
          The essentials before you start your first notebook.
        </p>
      </div>

      {/* Accordion List */}
      <div className="space-y-4">
        {FAQ_ITEMS.map((item, index) => {
          const isOpen = openIndices.includes(index);
          const questionId = `faq-trigger-${index}`;
          const answerId = `faq-answer-${index}`;

          return (
            <div
              key={item.question}
              className="rounded-2xl bg-[#111318] border border-[#30343E] overflow-hidden transition-colors hover:border-[#8B83FF]/40"
            >
              <h3>
                <button
                  ref={(el) => {
                    buttonRefs.current[index] = el;
                  }}
                  type="button"
                  id={questionId}
                  data-testid={`faq-accordion-trigger-${index}`}
                  aria-expanded={isOpen ? 'true' : 'false'}
                  aria-controls={answerId}
                  onClick={() => toggleItem(index)}
                  onKeyDown={(e) => handleKeyDown(e, index)}
                  className="w-full px-6 py-5 flex items-center justify-between text-left text-base sm:text-lg font-semibold text-[#F3F4F6] hover:text-[#8B83FF] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8B83FF] cursor-pointer"
                >
                  <span
                    data-testid={`faq-trigger-${index}`}
                    aria-expanded={isOpen ? 'true' : 'false'}
                  >
                    {item.question}
                  </span>
                  <div className="ml-4 shrink-0 text-[#8B83FF] w-7 h-7 rounded-lg bg-[#242238] flex items-center justify-center transition-transform">
                    {isOpen ? (
                      <Minus className="w-4 h-4" />
                    ) : (
                      <Plus className="w-4 h-4" />
                    )}
                  </div>
                </button>
              </h3>

              {isOpen && (
                <div
                  id={answerId}
                  role="region"
                  aria-labelledby={questionId}
                  data-testid={`faq-accordion-content-${index}`}
                  className="px-6 pb-6 pt-1 text-sm sm:text-base text-[#A1A6B3] leading-relaxed border-t border-[#30343E]/40"
                >
                  <div data-testid={`faq-answer-${index}`}>{item.answer}</div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
