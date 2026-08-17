/**
 * Notes client library.
 *
 * The assertions worth having are the ones about behaviour a person would
 * notice being wrong: an untitled note that becomes unfindable in the list, a
 * signed-out state rendered as a crash, and an API error message replaced by
 * something vaguer than what the server took the trouble to write.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

let session: { access_token: string } | null = { access_token: "tok" };

vi.mock("@/lib/supabaseClient", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session } }) },
  },
}));

import {
  NotesError,
  UNTITLED,
  createNote,
  deleteNote,
  displayTitle,
  listNotes,
  saveNote,
} from "@/lib/notes";

const note = (over: Partial<Parameters<typeof displayTitle>[0]> = {}) => ({
  id: "n1",
  title: "",
  body: "",
  created_at: "2026-08-16T12:00:00Z",
  updated_at: "2026-08-16T12:00:00Z",
  ...over,
});

beforeEach(() => {
  session = { access_token: "tok" };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * The stub declares (url, init) rather than no parameters so that
 * `spy.mock.calls` is typed as the tuple the assertions below read, instead of
 * an empty tuple that only a cast could get past the compiler.
 *
 * `init` is required, not optional: every fetch in lib/notes.ts passes one, so
 * a call arriving without it is a real defect and should fail to compile here
 * rather than be waved through with a `?.`.
 */
function stubFetch(res: Partial<Response> & { json?: () => Promise<unknown> }) {
  const spy = vi.fn(async (_url: string, _init: RequestInit) => res as Response);
  vi.stubGlobal("fetch", spy);
  return spy;
}

describe("displayTitle", () => {
  it("uses the title when there is one", () => {
    expect(displayTitle(note({ title: "Groceries" }))).toBe("Groceries");
  });

  it("falls back to the first non-empty body line so an untitled note is findable", () => {
    expect(displayTitle(note({ body: "\n\n  call the vet\nand the bank" })))
      .toBe("call the vet");
  });

  it("only calls a note untitled when it is genuinely empty", () => {
    expect(displayTitle(note({ title: "   ", body: "  \n " }))).toBe(UNTITLED);
  });

  it("truncates a long first line rather than blowing out the list", () => {
    expect(displayTitle(note({ body: "x".repeat(200 ) })).length).toBe(80);
  });
});

describe("listNotes", () => {
  it("returns null when signed out rather than throwing", async () => {
    session = null;
    await expect(listNotes()).resolves.toBeNull();
  });

  it("sends the bearer token", async () => {
    const spy = stubFetch({ ok: true, json: async () => ({ notes: [] }) });
    await listNotes();
    expect(spy).toHaveBeenCalledWith("/api/notes", {
      headers: { Authorization: "Bearer tok" },
    });
  });

  it("surfaces the API's own message, which is written for a person", async () => {
    stubFetch({ ok: false, json: async () => ({ error: "Could not load your notes" }) });
    await expect(listNotes()).rejects.toThrow("Could not load your notes");
  });

  it("still throws something readable when the error body is not JSON", async () => {
    stubFetch({
      ok: false,
      json: async () => {
        throw new Error("not json");
      },
    });
    await expect(listNotes()).rejects.toBeInstanceOf(NotesError);
  });
});

describe("writes", () => {
  it("createNote posts with no body — content only ever arrives via PATCH", async () => {
    const spy = stubFetch({ ok: true, json: async () => ({ note: note() }) });
    await createNote();
    const [, init] = spy.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
  });

  it("saveNote PATCHes the id it was given", async () => {
    const spy = stubFetch({ ok: true, json: async () => ({ note: note() }) });
    await saveNote("abc", { title: "T", body: "B" });
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("/api/notes/abc");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({ title: "T", body: "B" });
  });

  it("never sends a user_id — ownership is the server's to decide", async () => {
    const spy = stubFetch({ ok: true, json: async () => ({ note: note() }) });
    await saveNote("abc", { title: "T", body: "B" });
    const [, init] = spy.mock.calls[0];
    expect(String(init.body)).not.toContain("user_id");
  });

  it("deleteNote resolves on success and reports the API message on failure", async () => {
    stubFetch({ ok: true, json: async () => ({ ok: true }) });
    await expect(deleteNote("abc")).resolves.toBeUndefined();

    stubFetch({ ok: false, json: async () => ({ error: "Note not found" }) });
    await expect(deleteNote("abc")).rejects.toThrow("Note not found");
  });

  it("refuses to write at all when signed out", async () => {
    session = null;
    const spy = stubFetch({ ok: true, json: async () => ({}) });
    await expect(createNote()).rejects.toBeInstanceOf(NotesError);
    await expect(saveNote("a", { title: "", body: "" })).rejects.toBeInstanceOf(NotesError);
    await expect(deleteNote("a")).rejects.toBeInstanceOf(NotesError);
    expect(spy).not.toHaveBeenCalled();
  });
});
