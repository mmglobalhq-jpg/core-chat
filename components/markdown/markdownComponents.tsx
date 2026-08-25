"use client";

/**
 * The one Markdown component map, shared by the REIT report body and chat replies.
 *
 * Raw HTML is disabled everywhere (no `rehype-raw`, no `dangerouslySetInnerHTML`),
 * so HTML or <script> in the source renders as inert text. That matters more for
 * chat than it did for reports: a chat reply can restate text from a web page or an
 * uploaded document, so the model's output is not a trusted channel.
 *
 * Two density variants, because the same map served both badly. Report prose wants
 * air (`my-6` between blocks, `mt-6` headings); a chat bubble with that spacing has
 * a blank line's worth of gap around every bullet and reads as though the answer is
 * falling apart. `chat` tightens the vertical rhythm and drops the top margin on a
 * leading element so a reply never starts with a gap.
 *
 * All colours come from `@theme` tokens — never hardcoded — so both variants follow
 * the light/dark theme.
 */
import type { Components } from "react-markdown";

// react-markdown passes an AST `node` prop to every component; strip it so it is
// never spread onto a DOM element (React would warn on the unknown attribute).
function omitNode<P extends object>(props: P): Omit<P, "node"> {
  const { node, ...rest } = props as P & { node?: unknown };
  void node;
  return rest;
}

export type MarkdownDensity = "report" | "chat";

interface Density {
  h1: string;
  h2: string;
  h3: string;
  h4: string;
  p: string;
  list: string;
  li: string;
  blockquote: string;
  hr: string;
  pre: string;
  table: string;
}

const DENSITY: Record<MarkdownDensity, Density> = {
  report: {
    h1: "mt-6 mb-3 text-2xl font-semibold text-foreground first:mt-0",
    h2: "mt-6 mb-2 text-xl font-semibold text-foreground",
    h3: "mt-5 mb-2 text-lg font-semibold text-foreground",
    h4: "mt-4 mb-2 text-base font-semibold text-foreground",
    p: "my-3 leading-7 text-foreground/90",
    list: "my-3 ml-5 space-y-1",
    li: "leading-7 text-foreground/90",
    blockquote: "my-4 border-l-2 border-border pl-4 italic text-muted-foreground",
    hr: "my-6 border-border",
    pre: "my-4 overflow-x-auto rounded-lg bg-muted p-3 font-mono text-sm text-foreground",
    table: "my-4",
  },
  chat: {
    // first:mt-0 throughout: a reply that opens with a heading or list must not
    // start with a leading gap inside the bubble.
    h1: "mt-4 mb-2 text-base font-semibold text-foreground first:mt-0",
    h2: "mt-4 mb-2 text-base font-semibold text-foreground first:mt-0",
    h3: "mt-3 mb-1.5 text-[15px] font-semibold text-foreground first:mt-0 md:text-sm",
    h4: "mt-3 mb-1.5 font-semibold text-foreground first:mt-0",
    p: "my-2 leading-relaxed first:mt-0 last:mb-0",
    // ml-5 keeps the marker inside the bubble's padding; space-y-1 is enough to
    // separate options without making a 5-item list look like 5 paragraphs.
    list: "my-2 ml-5 space-y-1 first:mt-0 last:mb-0",
    li: "leading-relaxed [&>p]:my-0",
    blockquote: "my-2 border-l-2 border-border pl-3 italic text-muted-foreground",
    hr: "my-3 border-border",
    pre: "my-2 overflow-x-auto rounded-lg bg-muted p-2.5 font-mono text-[13px] text-foreground",
    table: "my-2",
  },
};

export function markdownComponents(density: MarkdownDensity = "report"): Components {
  const d = DENSITY[density];
  return {
    h1: (props) => <h1 className={d.h1} {...omitNode(props)} />,
    h2: (props) => <h2 className={d.h2} {...omitNode(props)} />,
    h3: (props) => <h3 className={d.h3} {...omitNode(props)} />,
    h4: (props) => <h4 className={d.h4} {...omitNode(props)} />,
    p: (props) => <p className={d.p} {...omitNode(props)} />,
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
    ul: (props) => <ul className={`list-disc ${d.list}`} {...omitNode(props)} />,
    ol: (props) => <ol className={`list-decimal ${d.list}`} {...omitNode(props)} />,
    li: (props) => <li className={d.li} {...omitNode(props)} />,
    blockquote: (props) => <blockquote className={d.blockquote} {...omitNode(props)} />,
    hr: (props) => <hr className={d.hr} {...omitNode(props)} />,
    // The option label ("Delta Air Lines:") is nearly always bold, so this is the
    // colour accent that separates one option from its details.
    strong: (props) => <strong className="font-semibold text-foreground" {...omitNode(props)} />,
    em: (props) => <em className="italic" {...omitNode(props)} />,
    code: (props) => (
      <code
        className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] text-foreground"
        {...omitNode(props)}
      />
    ),
    pre: (props) => <pre className={d.pre} {...omitNode(props)} />,
    table: (props) => (
      // Wide tables scroll inside their own container; the bubble never widens and
      // the page never scrolls sideways.
      <div className={`${d.table} overflow-x-auto`}>
        <table className="w-full border-collapse text-sm" {...omitNode(props)} />
      </div>
    ),
    thead: (props) => <thead className="border-b border-border" {...omitNode(props)} />,
    th: (props) => (
      <th className="border border-border px-3 py-2 text-left font-semibold" {...omitNode(props)} />
    ),
    td: (props) => <td className="border border-border px-3 py-2 align-top" {...omitNode(props)} />,
  };
}
