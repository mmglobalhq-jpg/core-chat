import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { MessageBubble } from "@/components/chat/MessageBubble";
import { toolActivityLabel } from "@/lib/toolActivity";

describe("tool activity label", () => {
  it("names the web search rather than showing a raw tool id", () => {
    expect(toolActivityLabel("search_web")).toBe("Searching the web…");
  });

  it("covers each tool family", () => {
    expect(toolActivityLabel("query_knowledge_base")).toMatch(/knowledge base/i);
    expect(toolActivityLabel("list_calendar_events")).toMatch(/calendar/i);
    expect(toolActivityLabel("create_calendar_event")).toMatch(/Adding/i);
    expect(toolActivityLabel("search_flights")).toMatch(/flights/i);
  });

  it("falls back to a human phrase for an unknown tool", () => {
    // Never show `some_new_tool` to the user.
    expect(toolActivityLabel("some_new_tool")).toBe("Working…");
  });
});

describe("the streaming bubble's status line", () => {
  it("shows what the backend is doing before the first token arrives", () => {
    render(<MessageBubble role="assistant" content="" loading activity="Searching the web…" />);
    expect(screen.getByText("Searching the web…")).toBeInTheDocument();
  });

  it("disappears once text arrives — the reply is its own status", () => {
    render(
      <MessageBubble role="assistant" content="Here are the options" loading activity="Searching the web…" />,
    );
    expect(screen.queryByText("Searching the web…")).not.toBeInTheDocument();
  });

  it("is not shown on a settled reply", () => {
    render(<MessageBubble role="assistant" content="" activity="Searching the web…" />);
    expect(screen.queryByText("Searching the web…")).not.toBeInTheDocument();
  });
});
