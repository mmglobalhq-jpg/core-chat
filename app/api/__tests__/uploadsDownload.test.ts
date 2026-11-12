import { describe, it, expect, vi, afterEach } from "vitest";
import { GET } from "@/app/api/uploads/download/route";

afterEach(() => vi.unstubAllGlobals());

describe("GET /api/uploads/download", () => {
  it("refuses without a ticket and never calls the backend", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const r = await GET(new Request("https://app/api/uploads/download"));
    expect(r.status).toBe(403);
    expect(f).not.toHaveBeenCalled();
  });

  it("streams the backend body through with download headers and forwards Range", async () => {
    const f = vi.fn().mockResolvedValue(
      new Response("456789", {
        status: 206,
        headers: {
          "content-type": "application/octet-stream",
          "content-disposition": 'attachment; filename="book.m4b"',
          "content-range": "bytes 4-9/10",
          "accept-ranges": "bytes",
          "set-cookie": "should-not-pass=1",
        },
      }),
    );
    vi.stubGlobal("fetch", f);
    const r = await GET(
      new Request("https://app/api/uploads/download?t=abc.def", { headers: { range: "bytes=4-" } }),
    );
    expect(r.status).toBe(206);
    expect(await r.text()).toBe("456789");
    expect(r.headers.get("content-disposition")).toContain("book.m4b");
    expect(r.headers.get("content-range")).toBe("bytes 4-9/10");
    expect(r.headers.get("set-cookie")).toBeNull();
    const [url, init] = f.mock.calls[0];
    expect(String(url)).toMatch(/\/uploads\/download\?t=abc\.def$/);
    expect((init.headers as Record<string, string>).Range).toBe("bytes=4-");
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("passes the backend's refusal through", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: "download link expired - tap Download again" }), {
          status: 403,
        }),
      ),
    );
    const r = await GET(new Request("https://app/api/uploads/download?t=old"));
    expect(r.status).toBe(403);
    expect((await r.json()).detail).toContain("expired");
  });
});
