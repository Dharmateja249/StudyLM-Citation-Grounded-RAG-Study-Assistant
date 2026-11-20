import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'StudyLM - Grounded Multi-Source Study Workspace',
  description: 'AI-assisted research, study, and citation-backed knowledge synthesis',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased min-h-screen bg-[#191C23] text-[#F3F4F6] selection:bg-[#8B83FF]/30 selection:text-[#F3F4F6]">
        {children}
      </body>
    </html>
  );
}
