import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { MessageBubble } from "@/components/chat/MessageBubble";
import { smoothPartialMarkdown } from "@/components/markdown/MessageMarkdown";

const REPLY = [
  "Here are the options:",
  "",
  "*   **Delta Air Lines:** departs 12:05 PM, one stop in Atlanta.",
  "*   **American Airlines:** departs 12:40 PM, one stop in Charlotte.",
].join("\n");

describe("assistant replies render as Markdown", () => {
  // The defect this fixes: MessageBubble rendered {content} as raw text inside
  // whitespace-pre-wrap, so "*   **Delta Air Lines:**" appeared on screen with
  // every asterisk showing.
  it("turns bullets into a real list and bold into <strong>", () => {
    render(<MessageBubble role="assistant" content={REPLY} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(screen.getByText("Delta Air Lines:").tagName).toBe("STRONG");
    expect(screen.queryByText(/\*\*/)).not.toBeInTheDocument();
  });

  it("renders a GFM table inside a scroll container so the page never scrolls sideways", () => {
    const md = "| Airline | Departs |\n|---|---|\n| Delta | 12:05 PM |";
    const { container } = render(<MessageBubble role="assistant" content={md} />);
    expect(container.querySelector("table")).toBeInTheDocument();
    expect(container.querySelector(".overflow-x-auto")).toBeInTheDocument();
  });

  it("opens links in a new tab with a safe rel", () => {
    render(<MessageBubble role="assistant" content="[Delta](https://delta.com)" />);
    const link = screen.getByRole("link", { name: "Delta" });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("renders HTML in a reply as inert text, never as markup", () => {
    // A reply can restate text from a web page or an uploaded document, so the
    // model's output is not a trusted channel.
    const { container } = render(
      <MessageBubble role="assistant" content={'<img src=x onerror="alert(1)">hi'} />,
    );
    expect(container.querySelector("img")).toBeNull();
  });

  // User text is NOT Markdown: someone typing a price like "5 * 3" or *asterisks*
  // for emphasis means those characters.
  it("leaves user text literal", () => {
    render(<MessageBubble role="user" content="cost is 5 * 3 * 2 and **not bold**" />);
    expect(screen.getByText("cost is 5 * 3 * 2 and **not bold**")).toBeInTheDocument();
  });
});

describe("smoothPartialMarkdown (streaming)", () => {
  it("closes an unterminated bold run so the tail does not flicker as literal **", () => {
    expect(smoothPartialMarkdown("Options: **Delta Air Li")).toBe("Options: **Delta Air Li**");
  });

  it("closes an unterminated code fence rather than leaving the rest as a code block", () => {
    expect(smoothPartialMarkdown("run this:\n```\nnpm i")).toBe("run this:\n```\nnpm i\n```");
  });

  it("leaves a trailing list bullet alone", () => {
    // "* " starts a list item; treating it as emphasis would inject an asterisk
    // into the middle of the user's reply.
    expect(smoothPartialMarkdown("Options:\n* ")).toBe("Options:\n* ");
  });

  it("leaves balanced markup untouched", () => {
    const done = "**Delta:** 12:05 PM";
    expect(smoothPartialMarkdown(done)).toBe(done);
  });

  it("does not touch complete markup earlier in the message", () => {
    expect(smoothPartialMarkdown("**Delta:** 12:05\n\n**American")).toBe(
      "**Delta:** 12:05\n\n**American**",
    );
  });
});
