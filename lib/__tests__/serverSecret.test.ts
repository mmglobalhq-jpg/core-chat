import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { serverSecret, resetSecretCache } from "@/lib/serverSecret";

/**
 * Service-role keys now arrive as mounted files rather than environment variables,
 * so their values no longer appear in `docker inspect`, in `printenv`, or in every
 * child process. This narrows accidental exposure — it is not a privilege boundary,
 * since anyone who can `docker exec` can still read the file.
 *
 * The empty-string case below is the one that would break production if wrong.
 */
describe("serverSecret", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "secret-"));
    resetSecretCache();
    delete process.env.TEST_KEY;
    delete process.env.TEST_KEY_FILE;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    resetSecretCache();
    delete process.env.TEST_KEY;
    delete process.env.TEST_KEY_FILE;
  });

  const writeSecret = (contents: string) => {
    const p = join(dir, "k");
    writeFileSync(p, contents);
    process.env.TEST_KEY_FILE = p;
    return p;
  };

  it("reads from the file when one is configured", () => {
    writeSecret("from-file\n");
    expect(serverSecret("TEST_KEY")).toBe("from-file");
  });

  it("prefers the file over the environment", () => {
    writeSecret("from-file");
    process.env.TEST_KEY = "from-env";
    expect(serverSecret("TEST_KEY")).toBe("from-file");
  });

  it("falls back to the environment when no file is configured", () => {
    process.env.TEST_KEY = "from-env";
    expect(serverSecret("TEST_KEY")).toBe("from-env");
  });

  it("treats an EMPTY env var as absent", () => {
    // Compose cannot unset a variable inherited from env_file:, only override it,
    // so these are set to "". If "" won, every Supabase call would send an empty key.
    writeSecret("from-file");
    process.env.TEST_KEY = "";
    expect(serverSecret("TEST_KEY")).toBe("from-file");
  });

  it("degrades to the environment when the file is missing", () => {
    process.env.TEST_KEY_FILE = join(dir, "does-not-exist");
    process.env.TEST_KEY = "from-env";
    // A missing mount must not take the app down.
    expect(serverSecret("TEST_KEY")).toBe("from-env");
  });

  it("degrades to the environment when the file is empty", () => {
    writeSecret("   \n");
    process.env.TEST_KEY = "from-env";
    expect(serverSecret("TEST_KEY")).toBe("from-env");
  });

  it("strips a trailing newline", () => {
    // `echo secret > file` adds one; sending it to Supabase would 401.
    writeSecret("abc123\n");
    expect(serverSecret("TEST_KEY")).toBe("abc123");
  });

  it("returns undefined when nothing is set", () => {
    expect(serverSecret("TEST_KEY")).toBeUndefined();
  });

  it("caches the file rather than re-reading per call", () => {
    const p = writeSecret("first");
    expect(serverSecret("TEST_KEY")).toBe("first");
    writeFileSync(p, "second");
    expect(serverSecret("TEST_KEY")).toBe("first");
    resetSecretCache();
    expect(serverSecret("TEST_KEY")).toBe("second");
  });
});
