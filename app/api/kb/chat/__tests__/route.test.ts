import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/kb/chat/route";

afterEach(() => vi.unstubAllGlobals());

function req(body: unknown): Request {
  return new Request("http://localhost/api/kb/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer jwt" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/kb/chat", () => {
  it("forwards a bounded payload with the caller's JWT and pipes the stream through", async () => {
    const upstream = vi.fn(async () =>
      new Response('data: {"token":"hi"}\n\n', { status: 200, headers: { "Content-Type": "text/event-stream" } }),
    );
    vi.stubGlobal("fetch", upstream);

    const res = await POST(
      req({
        text: "  what changed?  ",
        chat_id: "c1",
        timezone: "America/Chicago",
        history: [
          { role: "user", content: "q1" },
          { role: "assistant", content: "a1", sources: [{ document_id: "d1", title: "Doc" }, { title: "" }, "junk"] },
          { role: "system", content: "ignored" },
        ],
        model: "not forwarded",
      }),
    );

    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(await res.text()).toBe('data: {"token":"hi"}\n\n');
    const [url, init] = upstream.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/kb\/chat\/stream$/);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer jwt");
    expect(JSON.parse(init.body as string)).toEqual({
      text: "what changed?",
      chat_id: "c1",
      timezone: "America/Chicago",
      history: [
        { role: "user", content: "q1" },
        { role: "assistant", content: "a1", sources: [{ document_id: "d1", title: "Doc" }] },
      ],
    });
  });

  it("rejects an empty message without calling the backend", async () => {
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);
    const res = await POST(req({ text: "   " }));
    expect(res.status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("returns the gateway's refusal as JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ detail: "authentication required for the knowledge base" }, { status: 401 })));
    const res = await POST(req({ text: "hi" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "authentication required for the knowledge base" });
  });
});
