import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({ authHeaders: async () => ({ "Content-Type": "application/json" }) }));

import { parseSources, sendKnowledgeChat, toKnowledgeHistory } from "@/lib/knowledgeApi";

function sseResponse(frames: unknown[]): Response {
  const body = frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join("");
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

afterEach(() => vi.unstubAllGlobals());

describe("sendKnowledgeChat", () => {
  it("streams tokens, reports tool activity, and returns the cited sources", async () => {
    const fetchMock = vi.fn(async () =>
      sseResponse([
        { tool_call: { name: "search_knowledge", args: { query: "x" } } },
        { token: "Delinquencies rose " },
        { token: "[1]." },
        { sources: [{ n: 1, document_id: "d1", title: "Sep 11", chunk_index: 4, excerpt: "rose to 6.9%" }] },
        { status: "completed" },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);
    const tokens: string[] = [];
    const tools: string[] = [];

    const out = await sendKnowledgeChat("q", [], "chat-1", {
      onToken: (t) => tokens.push(t),
      onActivity: (n) => tools.push(n),
    });

    expect(out).toEqual({
      reply: "Delinquencies rose [1].",
      status: "completed",
      sources: [{ n: 1, document_id: "d1", title: "Sep 11", chunk_index: 4, excerpt: "rose to 6.9%" }],
    });
    expect(tokens).toEqual(["Delinquencies rose ", "[1]."]);
    expect(tools).toEqual(["search_knowledge"]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/kb/chat");
    expect(JSON.parse(init.body as string)).toMatchObject({ text: "q", history: [], chat_id: "chat-1" });
  });

  it("throws the server's error for a non-stream response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "authentication required" }, { status: 401 })));
    await expect(sendKnowledgeChat("q", [], "c")).rejects.toThrow("authentication required");
  });
});

describe("toKnowledgeHistory", () => {
  it("attaches each answer's cited documents once, and skips empty turns", () => {
    const history = toKnowledgeHistory([
      { role: "user", content: "Summarize Aug 28" },
      {
        role: "assistant",
        content: "It covered MBS [1] and CMBS [2].",
        sources: [
          { n: 1, document_id: "d-aug", title: "Aug 28", chunk_index: 0, excerpt: "a" },
          { n: 2, document_id: "d-aug", title: "Aug 28", chunk_index: 9, excerpt: "b" },
        ],
      },
      { role: "assistant", content: "" },
    ]);
    expect(history).toEqual([
      { role: "user", content: "Summarize Aug 28" },
      { role: "assistant", content: "It covered MBS [1] and CMBS [2].", sources: [{ document_id: "d-aug", title: "Aug 28" }] },
    ]);
  });
});

describe("parseSources", () => {
  it("drops malformed entries", () => {
    expect(parseSources([null, { n: "1", title: "x" }, { n: 2, title: "ok" }])).toEqual([
      { n: 2, title: "ok", document_id: null, chunk_index: null, excerpt: "" },
    ]);
  });
});

describe("a dropped connection", () => {
  it("is retried once and then succeeds", async () => {
    const { fetchWithOneRetry } = await import("@/lib/knowledgeApi");
    const doFetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(new Response("ok"));
    const res = await fetchWithOneRetry(doFetch, undefined, 0);
    expect(await res.text()).toBe("ok");
    expect(doFetch).toHaveBeenCalledTimes(2);
  });

  it("explains itself if it fails twice, and never retries a Stop", async () => {
    const { fetchWithOneRetry } = await import("@/lib/knowledgeApi");
    const failing = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(fetchWithOneRetry(failing, undefined, 0)).rejects.toThrow(/restarting/);

    const controller = new AbortController();
    controller.abort();
    const aborted = vi.fn().mockRejectedValue(new DOMException("aborted", "AbortError"));
    await expect(fetchWithOneRetry(aborted, controller.signal, 0)).rejects.toThrow();
    expect(aborted).toHaveBeenCalledTimes(1);
  });
});
