"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Safe Markdown renderer for REIT report bodies.
 *
 * Raw HTML is disabled (no `rehype-raw`, no `dangerouslySetInnerHTML`), so any HTML
 * or <script> in the source is rendered as inert text, never executed. Links open
 * in a new tab with `rel="noopener noreferrer nofollow"`; react-markdown's default
 * URL sanitizer strips `javascript:`/`data:` URLs. GFM tables are wrapped in a
 * horizontally-scrollable container so wide tables never overflow the page.
 */

// react-markdown passes an AST `node` prop to every component; strip it so it is
// never spread onto a DOM element (React would warn on the unknown attribute).
function omitNode<P extends object>(props: P): Omit<P, "node"> {
  const { node, ...rest } = props as P & { node?: unknown };
  void node;
  return rest;
}

const components: Components = {
  h1: (props) => (
    <h1 className="mt-6 mb-3 text-2xl font-semibold text-foreground first:mt-0" {...omitNode(props)} />
  ),
  h2: (props) => (
    <h2 className="mt-6 mb-2 text-xl font-semibold text-foreground" {...omitNode(props)} />
  ),
  h3: (props) => (
    <h3 className="mt-5 mb-2 text-lg font-semibold text-foreground" {...omitNode(props)} />
  ),
  h4: (props) => (
    <h4 className="mt-4 mb-2 text-base font-semibold text-foreground" {...omitNode(props)} />
  ),
  p: (props) => <p className="my-3 leading-7 text-foreground/90" {...omitNode(props)} />,
  a: (props) => {
    const { href } = props;
    return (
      <a
        {...omitNode(props)}
        href={href}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="text-primary underline underline-offset-2 hover:opacity-80"
      />
    );
  },
  ul: (props) => <ul className="my-3 ml-5 list-disc space-y-1" {...omitNode(props)} />,
  ol: (props) => <ol className="my-3 ml-5 list-decimal space-y-1" {...omitNode(props)} />,
  li: (props) => <li className="leading-7 text-foreground/90" {...omitNode(props)} />,
  blockquote: (props) => (
    <blockquote
      className="my-4 border-l-2 border-border pl-4 italic text-muted-foreground"
      {...omitNode(props)}
    />
  ),
  hr: (props) => <hr className="my-6 border-border" {...omitNode(props)} />,
  strong: (props) => <strong className="font-semibold text-foreground" {...omitNode(props)} />,
  code: (props) => (
    <code
      className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] text-foreground"
      {...omitNode(props)}
    />
  ),
  pre: (props) => (
    <pre
      className="my-4 overflow-x-auto rounded-lg bg-muted p-3 font-mono text-sm text-foreground"
      {...omitNode(props)}
    />
  ),
  table: (props) => (
    <div className="my-4 overflow-x-auto">
      <table className="w-full border-collapse text-sm" {...omitNode(props)} />
    </div>
  ),
  thead: (props) => <thead className="border-b border-border" {...omitNode(props)} />,
  th: (props) => (
    <th className="border border-border px-3 py-2 text-left font-semibold" {...omitNode(props)} />
  ),
  td: (props) => <td className="border border-border px-3 py-2 align-top" {...omitNode(props)} />,
};

export function ReportMarkdown({ markdown }: { markdown: string }) {
  return (
    <div className="text-[0.95rem]">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
