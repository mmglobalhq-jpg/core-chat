import { readFileSync } from "node:fs";

/**
 * Read a server-only secret from a mounted file, falling back to the environment.
 *
 * WHY
 * The service-role keys used to arrive purely as environment variables, which meant
 * their values showed up in `docker inspect`, in `printenv` inside the container,
 * and were inherited by every child process. That is not a privilege boundary on
 * this host — the only docker-group member is the sole operator — but it is a real
 * accidental-exposure surface, and it has already bitten: on 2026-08-06 a
 * service-role key reached a log file through a stack trace.
 *
 * SERVER ONLY. This imports `node:fs`, so any accidental import from a client
 * component fails the build rather than shipping a secret to the browser. The
 * existing client-bundle scan (app/reits/__tests__/bundleScan.test.ts) is the
 * second line of defence.
 *
 * CONTRACT — mirrors core-heartbeat/services/secrets.py exactly:
 *   1. contents of the file at `$NAME_FILE`, if set, readable and non-empty
 *   2. `$NAME`, if set and non-empty
 *   3. undefined
 *
 * An EMPTY environment variable counts as absent. That rule is load-bearing:
 * Docker Compose cannot unset a variable inherited from `env_file:`, only override
 * it, so the compose file sets these to "" and the mounted file takes over. If ""
 * won, every Supabase call would authenticate with an empty key.
 */

const cache = new Map<string, string>();

export function serverSecret(name: string): string | undefined {
  const path = process.env[`${name}_FILE`]?.trim();
  if (path) {
    const cached = cache.get(path);
    if (cached !== undefined) return cached;
    try {
      const value = readFileSync(path, "utf8").trim();
      if (value) {
        cache.set(path, value);
        return value;
      }
      console.warn(`serverSecret: ${name} file ${path} is empty; falling back to env`);
    } catch {
      // Degrade to the environment rather than throwing — a missing mount should
      // not take the app down, it should behave as it did before this change.
      console.warn(`serverSecret: cannot read ${name} from ${path}; falling back to env`);
    }
  }
  const env = process.env[name];
  return env && env.length > 0 ? env : undefined;
}

/** Drop cached file contents. For tests, and after rotating a secret. */
export function resetSecretCache(): void {
  cache.clear();
}
