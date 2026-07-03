/**
 * Client-side entry point for sending a chat message to the backend.
 *
 * Calls the same-origin Next.js proxy route (`/api/intent`), which streams the
 * backend's SSE token events. Reads the response body progressively with a
 * reader loop, invoking `onToken` for each `{"token": ...}` fragment as it
 * arrives, and resolves with the fully-accumulated reply + terminal status.
 * Throws with a human-readable message on any failure (non-stream error
 * envelope, threshold rejection, or backend unreachable).
 */
export interface ChatResult {
  reply: string;
  status: string;
}

export async function sendChat(
  text: string,
  model?: string,
  onToken?: (token: string) => void,
  signal?: AbortSignal,
): Promise<ChatResult> {
  const res = await fetch("/api/intent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, model }),
    signal,
  });

  // A non-stream response is an error envelope (threshold reject, backend down).
  const contentType = res.headers.get("content-type") ?? "";
  if (!res.ok || !res.body || !contentType.includes("text/event-stream")) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `request failed (HTTP ${res.status})`);
  }

  let reply = "";
  let status = "completed";

  const handleEvent = (rawEvent: string) => {
    // One SSE event: take its `data:` payload (join multi-line data fields).
    const json = rawEvent
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("");
    if (!json) return;
    let evt: { token?: string; status?: string };
    try {
      evt = JSON.parse(json);
    } catch {
      return; // ignore keep-alives / partial noise
    }
    if (typeof evt.token === "string") {
      reply += evt.token;
      onToken?.(evt.token);
    }
    if (typeof evt.status === "string") {
      status = evt.status;
    }
  };

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE events are separated by a blank line ("\n\n").
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        handleEvent(buffer.slice(0, sep));
        buffer = buffer.slice(sep + 2);
      }
    }
    if (buffer.trim()) handleEvent(buffer); // flush a trailing event, if any
  } catch (err) {
    // User pressed Stop: aborting the fetch rejects the pending read(). Cancel
    // the reader (which drops the proxy->backend stream) and return the partial
    // reply gathered so far rather than surfacing an error.
    if (signal?.aborted || (err instanceof DOMException && err.name === "AbortError")) {
      await reader.cancel().catch(() => {});
      return { reply, status: "aborted" };
    }
    throw err;
  }

  return { reply, status };
}
