/**
 * Supabase-backed persistence for per-user chat history.
 *
 * Every call runs under the signed-in user's JWT via the browser `supabase`
 * singleton, so Row-Level Security (see the `chats` / `messages` policies) scopes
 * all reads and writes to `auth.uid()` — a user can only ever see or mutate their
 * own conversations. Mirrors the own-row pattern already used by `useIsAdmin` /
 * `useProfile`.
 *
 * Every function is best-effort and **short-circuits when there is no session**
 * (returns empty / no-ops) so the app degrades gracefully when signed out and so
 * unit tests never touch the network.
 */
import { supabase } from "@/lib/supabaseClient";
import type { ChatKind, ChatRow, KnowledgeSource, Message, Role } from "@/lib/types";

/** The signed-in user's id, or null. Exported so callers that make several writes
 *  in a row (e.g. the store's persistTurn) can resolve it once and thread it in. */
export async function getUserId(): Promise<string | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.user?.id ?? null;
}

/** The signed-in user's chats of one kind, most-recently-updated first (metadata only).
 *  Main chat and Knowledge chat keep separate histories (migration 0013). */
export async function listChats(kind: ChatKind = "main"): Promise<ChatRow[]> {
  const uid = await getUserId();
  if (!uid) return [];
  const { data, error } = await supabase
    .from("chats")
    .select("id, title, created_at, updated_at")
    .eq("kind", kind)
    .eq("hidden", false) // hidden chats are removed from Recent but kept in the DB
    .order("updated_at", { ascending: false });
  if (error || !data) return [];
  return data as ChatRow[];
}

/** The ordered messages of one chat (oldest first). RLS enforces ownership. */
export async function loadMessages(chatId: string): Promise<Message[]> {
  const uid = await getUserId();
  if (!uid) return [];
  const { data, error } = await supabase
    .from("messages")
    .select("id, role, content, intent, created_at")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: true });
  if (error || !data) return [];
  return data.map((row) => {
    const sources = (row.intent as { sources?: KnowledgeSource[] } | null)?.sources;
    return {
      id: row.id as string,
      role: row.role as Role,
      content: (row.content as string) ?? "",
      createdAt: Date.parse(row.created_at as string) || 0,
      ...(Array.isArray(sources) ? { sources } : {}),
    };
  });
}

/**
 * Ensure a chat row exists for `id`. Idempotent: the first call inserts (setting
 * the derived title); later calls for the same id do nothing (ignoreDuplicates),
 * so an established title is never clobbered by a subsequent turn. The explicit
 * `id` lets the client mint the UUID up front so the store and DB agree without a
 * round-trip / id remap.
 */
export async function ensureChat(
  uid: string,
  id: string,
  title: string,
  kind: ChatKind = "main",
): Promise<void> {
  await supabase
    .from("chats")
    .upsert(
      { id, user_id: uid, title, kind },
      { onConflict: "id", ignoreDuplicates: true },
    );
}

/** Persist one message and bump its parent chat's `updated_at` (recency order). */
export async function insertMessage(
  uid: string,
  chatId: string,
  message: Message,
): Promise<void> {
  void uid; // ownership enforced by RLS; uid resolved once by the caller
  await supabase.from("messages").insert({
    id: message.id, // client-minted UUID, so attachments (documents.message_id) link on reload
    chat_id: chatId,
    role: message.role,
    content: message.content,
    // Knowledge chat: keep the cited passages with the answer (messages.intent jsonb).
    ...(message.sources ? { intent: { sources: message.sources } } : {}),
  });
  await supabase
    .from("chats")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", chatId);
}

/** Rename a chat (schema/UI-ready; no rename control wired yet). */
export async function renameChat(chatId: string, title: string): Promise<void> {
  const uid = await getUserId();
  if (!uid) return;
  await supabase.from("chats").update({ title }).eq("id", chatId);
}

/**
 * Remove a chat from Recent WITHOUT deleting it: sets `hidden = true`. The row
 * and all its messages stay in the DB (recoverable), just excluded from
 * `listChats`. RLS `chats_update_own` already permits the owner to do this.
 */
export async function hideChat(chatId: string): Promise<void> {
  const uid = await getUserId();
  if (!uid) return;
  await supabase.from("chats").update({ hidden: true }).eq("id", chatId);
}
