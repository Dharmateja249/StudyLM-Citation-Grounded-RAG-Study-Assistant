'use client';

import React from 'react';

export function LandingFooter() {
  return (
    <footer
      role="contentinfo"
      data-testid="landing-footer"
      className="bg-[#111318] border-t border-[#30343E] py-12 px-4 sm:px-6 lg:px-8 mt-auto"
    >
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-8">
        {/* Brand & Status */}
        <div className="flex flex-col sm:flex-row items-center gap-6 text-center sm:text-left">
          <a href="#" className="flex items-center gap-2.5 text-lg font-bold text-[#F3F4F6]">
            <span className="w-2.5 h-2.5 rounded-full bg-[#8B83FF] shadow-[0_0_8px_#8B83FF]" />
            <span>StudyLM</span>
          </a>

          {/* Status Indicator */}
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#191C23] border border-[#30343E] text-xs text-[#A1A6B3]">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>All systems operational</span>
          </div>
        </div>

        {/* Navigation Links */}
        <div className="flex flex-wrap items-center justify-center gap-6 text-xs sm:text-sm text-[#A1A6B3]">
          <a href="#how-it-works" className="hover:text-[#F3F4F6] transition-colors">
            How it works
          </a>
          <a href="#features" className="hover:text-[#F3F4F6] transition-colors">
            Features
          </a>
          <a href="#use-cases" className="hover:text-[#F3F4F6] transition-colors">
            Use Cases
          </a>
          <a href="#faq" className="hover:text-[#F3F4F6] transition-colors">
            FAQ
          </a>
          <a
            href="https://github.com"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-[#F3F4F6] transition-colors"
          >
            GitHub
          </a>
          <a
            href="#"
            className="hover:text-[#F3F4F6] transition-colors"
          >
            Documentation
          </a>
        </div>

        {/* Copyright */}
        <div className="text-xs text-[#737B8C] text-center md:text-right">
          &copy; 2026 StudyLM. All rights reserved.
        </div>
      </div>
    </footer>
  );
}
