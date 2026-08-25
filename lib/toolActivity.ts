/**
 * Human labels for the `tool_call` events the backend streams.
 *
 * The gateway has emitted these since feature 007 ("so the UI can show a
 * reading/searching-the-vault indicator") but `lib/api.ts` only ever handled
 * `token` and `status`, so every tool run was invisible. A turn that spends eight
 * seconds searching the web looked identical to one that was simply slow — which
 * is part of why being asked "would you like me to search?" felt like the only
 * signal that a search existed at all.
 *
 * Matching is by prefix on the tool family, so a tool added to a family gets a
 * label without touching this file. Unknown names fall back to a generic phrase
 * rather than showing a raw identifier like `query_knowledge_base` to the user.
 */
const LABELS: [prefix: string, label: string][] = [
  ["search_flights", "Searching flights…"],
  ["search_web", "Searching the web…"],
  ["fetch_url", "Reading a page…"],
  ["query_knowledge_base", "Searching your knowledge base…"],
  ["list_calendar", "Checking your calendar…"],
  ["create_calendar", "Adding to your calendar…"],
  ["update_calendar", "Updating your calendar…"],
  ["delete_calendar", "Removing from your calendar…"],
  ["reread_attachment", "Looking at your attachment…"],
  ["read_user_note", "Reading your notes…"],
  ["write_user_note", "Writing a note…"],
  ["list_user_notes", "Reading your notes…"],
  ["search_user_notes", "Searching your notes…"],
  ["reit", "Reading REIT research…"],
  ["briefing", "Reading your briefing…"],
];

export function toolActivityLabel(toolName: string): string {
  const name = toolName.toLowerCase();
  for (const [prefix, label] of LABELS) {
    if (name.startsWith(prefix) || name.includes(prefix)) return label;
  }
  return "Working…";
}
