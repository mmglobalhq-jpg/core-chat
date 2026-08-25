"use client";

/**
 * Markdown for one assistant chat reply.
 *
 * Rendered CONTINUOUSLY while streaming, the way Claude and Gemini do, rather than
 * showing plain text and swapping to Markdown at the end. The swap approach never
 * shows a broken `**`, but it reflows the whole answer the instant streaming stops,
 * which reads as a glitch on every single reply instead of occasionally on one
 * word. `smoothPartialMarkdown` takes the remaining sting out of the streaming case.
 *
 * Memoised on `content` because the parent re-renders on every token flush: only
 * the streaming bubble's text actually changes, so every settled reply skips both
 * the parse and the render. Without this the O(1) re-render that MessageBubble's
 * memo already buys would be spent again on re-parsing every finished message.
 */
import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { markdownComponents } from "@/components/markdown/markdownComponents";

const COMPONENTS = markdownComponents("chat");

/**
 * Hide the two artefacts a half-arrived token stream actually produces.
 *
 * Mid-stream the text can end inside an unclosed span — "**Delta Air Li" — which
 * react-markdown renders with the asterisks showing, so the reply flickers between
 * literal `**` and bold as each token lands. Closing an odd delimiter at the very
 * end costs one string scan and makes the tail render as the emphasis it is about
 * to become. Only the LAST unterminated run is touched; complete markup earlier in
 * the message is left exactly as written.
 *
 * An unterminated code fence is closed for the same reason: without it the entire
 * remainder of a reply renders as one code block until the closing fence arrives.
 */
export function smoothPartialMarkdown(text: string): string {
  let out = text;

  // Unbalanced ``` fence -> close it so the tail is a code block, not the rest of
  // the reply. Counting fences is enough; nesting is not legal in GFM.
  if ((out.match(/```/g) ?? []).length % 2 === 1) {
    out += "\n```";
  } else {
    // Only consider inline emphasis when we are not inside a fence, so we never
    // inject asterisks into code the user might copy.
    const tail = out.slice(out.lastIndexOf("\n") + 1);
    // "**" first: a lone trailing "*" of an odd "***" run is handled by the second
    // pass. Ignore a trailing "* " which is a list bullet, not emphasis.
    if ((tail.match(/\*\*/g) ?? []).length % 2 === 1) out += "**";
    const singles = (tail.replace(/\*\*/g, "").match(/\*/g) ?? []).length;
    if (singles % 2 === 1 && !/(^|\s)\*\s*$/.test(tail)) out += "*";
    if ((tail.match(/`/g) ?? []).length % 2 === 1) out += "`";
  }
  return out;
}

function MessageMarkdownImpl({ content, streaming }: { content: string; streaming?: boolean }) {
  const text = streaming ? smoothPartialMarkdown(content) : content;
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
      {text}
    </ReactMarkdown>
  );
}

export const MessageMarkdown = memo(MessageMarkdownImpl);
