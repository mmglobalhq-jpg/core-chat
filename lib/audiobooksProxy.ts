/**
 * The only request shapes the Audiobooks proxy (app/api/audiobooks/[...path]/route.ts) forwards to
 * core-heartbeat. Kept out of the route file because a Next.js route module may export only its handlers.
 */
const JOB = /^[0-9a-f]{16}$/;
const VOICE = /^[a-z]{2}-[A-Z]{2}-[A-Za-z]+Neural$/;
const ACTIONS = new Set(["confirm", "cancel", "retry"]);

/** The gateway path for an allowed request, or null. */
export function allowedPath(method: string, parts: string[]): string | null {
  const [a, b, c, ...rest] = parts;
  if (rest.length) return null;
  if (method === "GET") {
    if (a === "voices" && b === undefined) return "/audiobooks/voices";
    if (a === "voices" && b && VOICE.test(b) && c === "sample") return `/audiobooks/voices/${b}/sample`;
    if (a === "jobs" && b === undefined) return "/audiobooks/jobs";
    if (a === "jobs" && b && JOB.test(b) && c === undefined) return `/audiobooks/jobs/${b}`;
  }
  if (method === "POST") {
    if (a === "jobs" && b === undefined) return "/audiobooks/jobs";
    if (a === "jobs" && b && JOB.test(b) && c && ACTIONS.has(c)) return `/audiobooks/jobs/${b}/${c}`;
  }
  if (method === "DELETE" && a === "jobs" && b && JOB.test(b) && c === undefined) return `/audiobooks/jobs/${b}`;
  return null;
}
