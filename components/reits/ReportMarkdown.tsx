"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { markdownComponents } from "@/components/markdown/markdownComponents";

/**
 * Safe Markdown renderer for REIT report bodies.
 *
 * The component map moved to `components/markdown/markdownComponents` when chat
 * started rendering Markdown too — one implementation, two density variants, so a
 * fix to link handling or table overflow cannot land in one and miss the other.
 * Raw HTML stays disabled (no `rehype-raw`, no `dangerouslySetInnerHTML`); links
 * open in a new tab with `rel="noopener noreferrer nofollow"`, and react-markdown's
 * default URL sanitizer strips `javascript:`/`data:` URLs.
 */
const COMPONENTS = markdownComponents("report");

export function ReportMarkdown({ markdown }: { markdown: string }) {
  return (
    <div className="text-[0.95rem]">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
