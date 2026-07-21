/**
 * Client-bundle security scan: the browser-served assets in `.next/static` must never
 * contain the REIT service-role env names, the issuer-specific table names, the
 * reader-contract RPC names, or the server-only client module names. Server output
 * (`.next/server`) may legitimately reference the RPC names; only the client bundle is
 * checked here.
 *
 * Self-skips when the app has not been built (`.next/static` absent), so it never
 * blocks the unit suite. To exercise it: `pnpm build` then `pnpm test`.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const STATIC_DIR = join(process.cwd(), ".next", "static");

const FORBIDDEN = [
  "REITS_SUPABASE",
  "SUPABASE_SERVICE_ROLE_KEY",
  "reit_arr_",
  "reit_orc_",
  "reit_research_get_report",
  "reit_research_list_reports",
  "reit_research_list_issuers",
  "supabaseReits",
  "getSupabaseReits",
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(js|css)$/.test(entry)) out.push(p);
  }
  return out;
}

describe("client bundle security scan", () => {
  it("never ships REIT secrets, table names, RPC names, or server-only modules", () => {
    if (!existsSync(STATIC_DIR)) {
      // Not built — nothing to scan. Run `pnpm build` first to exercise this.
      return;
    }
    const offenders: string[] = [];
    for (const file of walk(STATIC_DIR)) {
      const text = readFileSync(file, "utf8");
      for (const tok of FORBIDDEN) {
        if (text.includes(tok)) offenders.push(`${tok} in ${file}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
