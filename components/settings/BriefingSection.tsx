"use client";

/**
 * Briefing preferences, rendered inside the shared settings sheet.
 *
 * Mobile rules from core-chat/CLAUDE.md apply here: this is inside a sheet that
 * can be opened from the drawer, controls are ≥44pt on coarse pointers, and no
 * state lives in a component the drawer can unmount.
 */

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabaseClient";
import { DEFAULT_PREFS, type BriefingPrefs } from "@/lib/briefing";

const COMMON_ZONES = [
  "America/Chicago",
  "America/New_York",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "UTC",
];

export function BriefingSection() {
  const [prefs, setPrefs] = useState<BriefingPrefs>(DEFAULT_PREFS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [topicDraft, setTopicDraft] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        if (!cancelled) setLoading(false);
        return;
      }
      const res = await fetch("/api/briefing/prefs", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!cancelled && res.ok) {
        const body = await res.json();
        // A user with no row yet is normal, not an error.
        if (body.prefs) {
          setPrefs({
            ...DEFAULT_PREFS,
            ...body.prefs,
            // Postgres returns `time` as HH:MM:SS. The <input type="time"> only
            // shows HH:MM, so slicing for display alone left the SECONDS in
            // state — and saving a form nobody had touched posted "06:30:00",
            // which the API rejected as malformed. Normalise on the way in.
            deliver_at: String(body.prefs.deliver_at ?? "06:30").slice(0, 5),
          });
        }
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async () => {
    setSaving(true);
    setStatus(null);
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      setStatus("Not signed in.");
      setSaving(false);
      return;
    }
    const res = await fetch("/api/briefing/prefs", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(prefs),
    });
    const body = await res.json().catch(() => ({}));
    setStatus(res.ok ? "Saved." : (body.error ?? "Could not save."));
    setSaving(false);
  };

  const addTopic = () => {
    const topic = topicDraft.trim();
    if (!topic || prefs.topics.includes(topic)) return;
    setPrefs({ ...prefs, topics: [...prefs.topics, topic].slice(0, 12) });
    setTopicDraft("");
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading preferences…</p>;
  }

  return (
    <div className="space-y-5">
      <Toggle
        label="Daily briefing"
        description="One briefing a day: the top five stories plus a deep dive."
        checked={prefs.enabled}
        onChange={(enabled) => setPrefs({ ...prefs, enabled })}
      />

      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">Topics</label>
        {/* Honest about the limit. Topics promote matching stories within the
            news feeds the briefing is permitted to read — they do not go and
            search the web, because no news-search source is available on terms
            this pipeline will accept. Saying "from your topics" implied a
            personalised feed that does not exist. */}
        <p className="text-sm text-muted-foreground">
          Stories matching these get promoted in the ranking. They don&apos;t add new
          sources, so a topic the feeds don&apos;t cover won&apos;t appear.
        </p>
        <div className="flex flex-wrap gap-2">
          {prefs.topics.map((topic) => (
            <button
              key={topic}
              type="button"
              onClick={() =>
                setPrefs({ ...prefs, topics: prefs.topics.filter((t) => t !== topic) })
              }
              className="min-h-9 rounded-full bg-muted px-3 text-sm text-foreground hover:bg-muted/70"
            >
              {topic} <span className="text-muted-foreground">×</span>
            </button>
          ))}
          {prefs.topics.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No topics yet — general news is used.
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <input
            value={topicDraft}
            onChange={(e) => setTopicDraft(e.target.value)}
            // Enter adds a topic here rather than submitting anything, so it is
            // safe on touch — there is no send action to fire accidentally.
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addTopic();
              }
            }}
            placeholder="Add a topic"
            className="min-h-11 flex-1 rounded-lg border border-border bg-background px-3 text-sm"
          />
          <Button type="button" variant="secondary" className="min-h-11" onClick={addTopic}>
            Add
          </Button>
        </div>
      </div>

      <SourcesEditor />

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label htmlFor="briefing-time" className="text-sm font-medium text-foreground">
            Time
          </label>
          <input
            id="briefing-time"
            type="time"
            value={prefs.deliver_at.slice(0, 5)}
            onChange={(e) => setPrefs({ ...prefs, deliver_at: e.target.value })}
            className="min-h-11 w-full rounded-lg border border-border bg-background px-3 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="briefing-tz" className="text-sm font-medium text-foreground">
            Timezone
          </label>
          <select
            id="briefing-tz"
            value={prefs.timezone}
            onChange={(e) => setPrefs({ ...prefs, timezone: e.target.value })}
            className="min-h-11 w-full rounded-lg border border-border bg-background px-3 text-sm"
          >
            {COMMON_ZONES.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-2">
        <Toggle
          label="Email it to me"
          description="Send the briefing to your inbox when it is generated."
          checked={prefs.deliver_email}
          onChange={(deliver_email) => setPrefs({ ...prefs, deliver_email })}
        />
        {prefs.deliver_email && (
          <div className="space-y-1 pl-8">
            <label htmlFor="briefing-email" className="text-sm font-medium text-foreground">
              Send to
            </label>
            <input
              id="briefing-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={prefs.email_to ?? ""}
              onChange={(e) => setPrefs({ ...prefs, email_to: e.target.value })}
              placeholder="you@example.com"
              className="min-h-11 w-full rounded-lg border border-border bg-background px-3 text-sm"
            />
            {/* The job sends only when the toggle is on AND an address is set, so
                a half-filled form silently sends nothing. Say so rather than
                letting someone believe they subscribed. */}
            {!prefs.email_to?.trim() && (
              <p className="text-sm text-muted-foreground">
                No address yet — the briefing will be generated but not emailed.
              </p>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        <Button type="button" onClick={save} disabled={saving} className="min-h-11">
          {saving ? "Saving…" : "Save"}
        </Button>
        {status && <span className="text-sm text-muted-foreground">{status}</span>}
      </div>
    </div>
  );
}

interface UserSource {
  id: string;
  kind: string;
  url: string;
  name: string;
  last_error: string | null;
}

/**
 * Sites and feeds the user added.
 *
 * Paste a bare domain and the backend resolves its feed — that is the whole
 * point, because almost nobody knows a site's RSS URL. When a site cannot be
 * used, the backend's reason is shown verbatim: "this sits behind a paywall" is
 * far more useful than "invalid source", and it is usually a decision by the
 * publisher rather than a bug we could fix.
 */
function SourcesEditor() {
  const [sources, setSources] = useState<UserSource[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);

  const token = async () =>
    (await supabase.auth.getSession()).data.session?.access_token ?? null;

  const load = useCallback(async () => {
    const t = await token();
    if (!t) return;
    const res = await fetch("/api/briefing/sources", {
      headers: { Authorization: `Bearer ${t}` },
    });
    if (res.ok) setSources((await res.json()).sources ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    const url = draft.trim();
    if (!url) return;
    setBusy(true);
    setError(null);
    setAdded(null);
    const t = await token();
    if (!t) {
      setError("Not signed in.");
      setBusy(false);
      return;
    }
    const res = await fetch("/api/briefing/sources", {
      method: "POST",
      headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      setDraft("");
      // Say what was actually added — pasting a homepage and getting its feed
      // is surprising unless it is spelled out.
      setAdded(
        body.kind === "rss"
          ? `Added ${body.name} — found its feed at ${body.url}`
          : `Added ${body.name} — no feed, so headlines will be read from the page`,
      );
      await load();
    } else {
      setError(body.error ?? "Could not add that source.");
    }
    setBusy(false);
  };

  const remove = async (id: string) => {
    const t = await token();
    if (!t) return;
    await fetch(`/api/briefing/sources?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${t}` },
    });
    await load();
  };

  return (
    <div className="space-y-2">
      <label htmlFor="briefing-source" className="text-sm font-medium text-foreground">
        Your sites and feeds
      </label>
      <p className="text-sm text-muted-foreground">
        Paste any news site and we&apos;ll find its feed. Sites that block automated
        readers, or sit behind a paywall, can&apos;t be added.
      </p>

      {sources.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {sources.map((s) => (
            <li key={s.id} className="flex items-start justify-between gap-2 p-2">
              <div className="min-w-0">
                <div className="truncate text-sm text-foreground">{s.name}</div>
                <div className="truncate text-xs text-muted-foreground">{s.url}</div>
                {s.last_error && (
                  <div className="text-xs text-destructive">{s.last_error}</div>
                )}
              </div>
              <button
                type="button"
                onClick={() => void remove(s.id)}
                aria-label={`Remove ${s.name}`}
                className="min-h-11 shrink-0 rounded-lg px-2 text-sm text-muted-foreground hover:bg-muted"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-2">
        <input
          id="briefing-source"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void add();
            }
          }}
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          placeholder="e.g. ft.com"
          className="min-h-11 flex-1 rounded-lg border border-border bg-background px-3 text-sm"
        />
        <Button type="button" variant="secondary" className="min-h-11"
                onClick={() => void add()} disabled={busy}>
          {busy ? "Checking…" : "Add"}
        </Button>
      </div>

      {added && <p className="text-sm text-muted-foreground">{added}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

function Toggle({
  label,
  description,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex items-start gap-3 ${disabled ? "opacity-60" : "cursor-pointer"}`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 size-5"
      />
      <span>
        <span className="block text-sm font-medium text-foreground">{label}</span>
        <span className="block text-sm text-muted-foreground">{description}</span>
      </span>
    </label>
  );
}
