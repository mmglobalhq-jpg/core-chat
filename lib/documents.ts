/**
 * Supabase-backed document uploads (the "Upload Docs" feature).
 *
 * Ownership mirrors chatHistory: the browser owns the `documents` row + the
 * `user-docs` Storage upload (both RLS-scoped to auth.uid()); the backend owns
 * parsing (docling) via the `/api/documents` proxy. All calls short-circuit when
 * signed out so tests never hit the network.
 */
import { supabase } from "@/lib/supabaseClient";
import { getUserId } from "@/lib/chatHistory";
import type { DocumentRow, DocumentStatus } from "@/lib/types";

const BUCKET = "user-docs";

/** Insert a `documents` row (status=uploading). Returns the new id, or null. */
export async function createDocument(
  docId: string,
  chatId: string,
  filename: string,
  contentType: string,
  sizeBytes: number,
): Promise<string | null> {
  const uid = await getUserId();
  if (!uid) return null;
  const { error } = await supabase.from("documents").insert({
    id: docId,
    user_id: uid,
    chat_id: chatId,
    filename,
    content_type: contentType,
    size_bytes: sizeBytes,
    status: "uploading",
  });
  return error ? null : docId;
}

/** Upload the original file bytes to `user-docs/<uid>/<docId>/original`. */
export async function uploadOriginal(docId: string, file: File): Promise<boolean> {
  const uid = await getUserId();
  if (!uid) return false;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(`${uid}/${docId}/original`, file, { upsert: true });
  return !error;
}

/** Ask the backend to parse the uploaded original (docling). Returns the result. */
export async function requestParse(
  docId: string,
  filename: string,
  contentType: string,
): Promise<{ status: DocumentStatus; error?: string }> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
    const res = await fetch("/api/documents", {
      method: "POST",
      headers,
      body: JSON.stringify({ doc_id: docId, filename, content_type: contentType }),
    });
    if (!res.ok) return { status: "error", error: `parse failed (HTTP ${res.status})` };
    const data = (await res.json().catch(() => ({}))) as {
      status?: string;
      error?: string;
    };
    return data.status === "ready"
      ? { status: "ready" }
      : { status: "error", error: data.error };
  } catch (e) {
    return { status: "error", error: e instanceof Error ? e.message : String(e) };
  }
}

/** Update a document's status (+ optional error). */
export async function setDocumentStatus(
  docId: string,
  status: DocumentStatus,
  error?: string,
): Promise<void> {
  const uid = await getUserId();
  if (!uid) return;
  await supabase
    .from("documents")
    .update({ status, error: error ?? null })
    .eq("id", docId);
}

/** Link a ready document to the user message it was sent with (for history). */
export async function attachToMessage(docId: string, messageId: string): Promise<void> {
  const uid = await getUserId();
  if (!uid) return;
  await supabase.from("documents").update({ message_id: messageId }).eq("id", docId);
}

/** All of a chat's documents (for rendering chips on reload). */
export async function listDocumentsForChat(chatId: string): Promise<DocumentRow[]> {
  const uid = await getUserId();
  if (!uid) return [];
  const { data, error } = await supabase
    .from("documents")
    .select("id, chat_id, message_id, filename, content_type, status, error")
    .eq("chat_id", chatId);
  if (error || !data) return [];
  return data as DocumentRow[];
}
