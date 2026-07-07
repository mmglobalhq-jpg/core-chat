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
import type { ChatRow, Message, Role } from "@/lib/types";

async function currentUserId(): Promise<string | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.user?.id ?? null;
}

/** All of the signed-in user's chats, most-recently-updated first (metadata only). */
export async function listChats(): Promise<ChatRow[]> {
  const uid = await currentUserId();
  if (!uid) return [];
  const { data, error } = await supabase
    .from("chats")
    .select("id, title, created_at, updated_at")
    .order("updated_at", { ascending: false });
  if (error || !data) return [];
  return data as ChatRow[];
}

/** The ordered messages of one chat (oldest first). RLS enforces ownership. */
export async function loadMessages(chatId: string): Promise<Message[]> {
  const uid = await currentUserId();
  if (!uid) return [];
  const { data, error } = await supabase
    .from("messages")
    .select("id, role, content, intent, created_at")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: true });
  if (error || !data) return [];
  return data.map((row) => ({
    id: row.id as string,
    role: row.role as Role,
    content: (row.content as string) ?? "",
    createdAt: Date.parse(row.created_at as string) || 0,
    intent: (row.intent as Message["intent"]) ?? undefined,
  }));
}

/**
 * Ensure a chat row exists for `id`. Idempotent: the first call inserts (setting
 * the derived title); later calls for the same id do nothing (ignoreDuplicates),
 * so an established title is never clobbered by a subsequent turn. The explicit
 * `id` lets the client mint the UUID up front so the store and DB agree without a
 * round-trip / id remap.
 */
export async function ensureChat(id: string, title: string): Promise<void> {
  const uid = await currentUserId();
  if (!uid) return;
  await supabase
    .from("chats")
    .upsert(
      { id, user_id: uid, title },
      { onConflict: "id", ignoreDuplicates: true },
    );
}

/** Persist one message and bump its parent chat's `updated_at` (recency order). */
export async function insertMessage(
  chatId: string,
  message: Message,
): Promise<void> {
  const uid = await currentUserId();
  if (!uid) return;
  await supabase.from("messages").insert({
    chat_id: chatId,
    role: message.role,
    content: message.content,
    intent: message.intent ?? null,
  });
  await supabase
    .from("chats")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", chatId);
}

/** Rename a chat (schema/UI-ready; no rename control wired yet). */
export async function renameChat(chatId: string, title: string): Promise<void> {
  const uid = await currentUserId();
  if (!uid) return;
  await supabase.from("chats").update({ title }).eq("id", chatId);
}

/** Delete a chat; `messages` rows cascade via the FK. RLS enforces ownership. */
export async function deleteChat(chatId: string): Promise<void> {
  const uid = await currentUserId();
  if (!uid) return;
  await supabase.from("chats").delete().eq("id", chatId);
}
