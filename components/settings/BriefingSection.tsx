"use client";

/**
 * Briefing preferences, rendered inside the shared settings sheet.
 *
 * Mobile rules from core-chat/CLAUDE.md apply here: this is inside a sheet that
 * can be opened from the drawer, controls are ≥44pt on coarse pointers, and no
 * state lives in a component the drawer can unmount.
 */

import { useEffect, useState } from "react";
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
        if (body.prefs) setPrefs({ ...DEFAULT_PREFS, ...body.prefs });
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
        description="Assemble one briefing a day from your topics."
        checked={prefs.enabled}
        onChange={(enabled) => setPrefs({ ...prefs, enabled })}
      />

      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">Topics</label>
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
