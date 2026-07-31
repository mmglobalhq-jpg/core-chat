// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { jwtVerify } from "jose";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mintServiceToken } from "@/lib/dataIntelligence/serviceToken";

const SECRET = "unit-test-shared-signing-secret-000000000000";
const FILE_SECRET = "unit-test-file-backed-signing-secret-111111";

/** Save/restore BOTH secret variables so tests are order-independent. */
function saveSecretEnv() {
  return {
    inline: process.env.DATA_INTELLIGENCE_SIGNING_SECRET,
    file: process.env.DATA_INTELLIGENCE_SIGNING_SECRET_FILE,
  };
}
function restoreSecretEnv(saved: ReturnType<typeof saveSecretEnv>) {
  if (saved.inline === undefined) delete process.env.DATA_INTELLIGENCE_SIGNING_SECRET;
  else process.env.DATA_INTELLIGENCE_SIGNING_SECRET = saved.inline;
  if (saved.file === undefined) delete process.env.DATA_INTELLIGENCE_SIGNING_SECRET_FILE;
  else process.env.DATA_INTELLIGENCE_SIGNING_SECRET_FILE = saved.file;
}

describe("mintServiceToken", () => {
  let saved: ReturnType<typeof saveSecretEnv>;
  beforeEach(() => {
    saved = saveSecretEnv();
    // The _FILE source takes precedence; clear it so these exercise the inline path.
    delete process.env.DATA_INTELLIGENCE_SIGNING_SECRET_FILE;
    process.env.DATA_INTELLIGENCE_SIGNING_SECRET = SECRET;
  });
  afterEach(() => restoreSecretEnv(saved));

  async function verify(token: string) {
    return jwtVerify(token, new TextEncoder().encode(SECRET), {
      issuer: "core-chat",
      audience: "data-intelligence-gateway",
    });
  }

  it("mints an HS256 service token with the correct claims", async () => {
    const token = await mintServiceToken({
      subject: "user-123",
      conversationId: "c1",
      requestId: "r1",
    });
    const { payload, protectedHeader } = await verify(token);
    expect(protectedHeader.alg).toBe("HS256");
    expect(payload.iss).toBe("core-chat");
    expect(payload.aud).toBe("data-intelligence-gateway");
    expect(payload.sub).toBe("user-123");
    expect(payload.roles).toEqual(["chat_user"]);
    expect(payload.scope).toBe("funds");
    expect(payload.token_type).toBe("service");
    expect(payload.conversation_id).toBe("c1");
    expect(payload.request_id).toBe("r1");
    expect(typeof payload.jti).toBe("string");
    expect((payload.exp as number) - (payload.iat as number)).toBeLessThanOrEqual(120);
  });

  it("clamps lifetime to 120 seconds", async () => {
    const token = await mintServiceToken({ subject: "u", lifetimeSeconds: 9999 });
    const { payload } = await verify(token);
    expect((payload.exp as number) - (payload.iat as number)).toBeLessThanOrEqual(120);
  });

  it("uses a unique jti per token", async () => {
    const a = await verify(await mintServiceToken({ subject: "u" }));
    const b = await verify(await mintServiceToken({ subject: "u" }));
    expect(a.payload.jti).not.toBe(b.payload.jti);
  });

  it("throws when the secret is not configured", async () => {
    delete process.env.DATA_INTELLIGENCE_SIGNING_SECRET;
    await expect(mintServiceToken({ subject: "u" })).rejects.toThrow(/SIGNING_SECRET/);
  });
});

// --- file-backed signing secret (production delivery) ----------------------
// Production mounts the secret read-only at /run/secrets/dig_service_token_secret.
// These tests only ever touch temporary files — never /etc/dig.
describe("mintServiceToken — DATA_INTELLIGENCE_SIGNING_SECRET_FILE", () => {
  let saved: ReturnType<typeof saveSecretEnv>;
  let dir: string;

  beforeEach(() => {
    saved = saveSecretEnv();
    dir = mkdtempSync(join(tmpdir(), "dig-secret-test-"));
    delete process.env.DATA_INTELLIGENCE_SIGNING_SECRET;
    delete process.env.DATA_INTELLIGENCE_SIGNING_SECRET_FILE;
  });
  afterEach(() => {
    restoreSecretEnv(saved);
    rmSync(dir, { recursive: true, force: true });
  });

  function writeSecret(name: string, contents: string): string {
    const path = join(dir, name);
    writeFileSync(path, contents, { encoding: "utf8", mode: 0o600 });
    return path;
  }

  async function verifyWith(token: string, secret: string) {
    return jwtVerify(token, new TextEncoder().encode(secret), {
      issuer: "core-chat",
      audience: "data-intelligence-gateway",
    });
  }

  it("mints a token using the secret read from the file", async () => {
    process.env.DATA_INTELLIGENCE_SIGNING_SECRET_FILE = writeSecret("s1", FILE_SECRET);
    const { payload, protectedHeader } = await verifyWith(
      await mintServiceToken({ subject: "user-file" }),
      FILE_SECRET,
    );
    expect(protectedHeader.alg).toBe("HS256");
    expect(payload.iss).toBe("core-chat");
    expect(payload.aud).toBe("data-intelligence-gateway");
    expect(payload.sub).toBe("user-file");
    expect(payload.roles).toEqual(["chat_user"]);
    expect((payload.exp as number) - (payload.iat as number)).toBeLessThanOrEqual(120);
  });

  it("strips exactly one trailing newline from the file", async () => {
    process.env.DATA_INTELLIGENCE_SIGNING_SECRET_FILE = writeSecret("s2", `${FILE_SECRET}\n`);
    // Verifies against the UNtrimmed secret -> proves the newline was removed.
    await expect(
      verifyWith(await mintServiceToken({ subject: "u" }), FILE_SECRET),
    ).resolves.toBeTruthy();
  });

  it("preserves a second trailing newline as part of the secret", async () => {
    process.env.DATA_INTELLIGENCE_SIGNING_SECRET_FILE = writeSecret("s3", `${FILE_SECRET}\n\n`);
    await expect(
      verifyWith(await mintServiceToken({ subject: "u" }), `${FILE_SECRET}\n`),
    ).resolves.toBeTruthy();
  });

  it("prefers the file over an inline env value when both are set", async () => {
    process.env.DATA_INTELLIGENCE_SIGNING_SECRET = SECRET;
    process.env.DATA_INTELLIGENCE_SIGNING_SECRET_FILE = writeSecret("s4", FILE_SECRET);
    const token = await mintServiceToken({ subject: "u" });
    await expect(verifyWith(token, FILE_SECRET)).resolves.toBeTruthy();
    await expect(verifyWith(token, SECRET)).rejects.toThrow();
  });

  it("falls back to the inline env value when the file variable is absent", async () => {
    process.env.DATA_INTELLIGENCE_SIGNING_SECRET = SECRET;
    await expect(
      verifyWith(await mintServiceToken({ subject: "u" }), SECRET),
    ).resolves.toBeTruthy();
  });

  it("fails on an empty file rather than minting an unsigned-equivalent token", async () => {
    process.env.DATA_INTELLIGENCE_SIGNING_SECRET_FILE = writeSecret("s5", "");
    await expect(mintServiceToken({ subject: "u" })).rejects.toThrow(/empty file/);
  });

  it("fails on a file containing only a newline", async () => {
    process.env.DATA_INTELLIGENCE_SIGNING_SECRET_FILE = writeSecret("s6", "\n");
    await expect(mintServiceToken({ subject: "u" })).rejects.toThrow(/empty file/);
  });

  it("fails safely when the file is missing", async () => {
    process.env.DATA_INTELLIGENCE_SIGNING_SECRET_FILE = join(dir, "does-not-exist");
    await expect(mintServiceToken({ subject: "u" })).rejects.toThrow(/could not be read/);
  });

  it("fails safely when the path is not a readable file", async () => {
    process.env.DATA_INTELLIGENCE_SIGNING_SECRET_FILE = dir; // a directory
    await expect(mintServiceToken({ subject: "u" })).rejects.toThrow(/could not be read/);
  });

  it("does NOT silently fall back to env when the configured file is unreadable", async () => {
    // A stale env value must never mask a broken mount: the gateway would reject
    // the resulting token and the cause would be invisible.
    process.env.DATA_INTELLIGENCE_SIGNING_SECRET = SECRET;
    process.env.DATA_INTELLIGENCE_SIGNING_SECRET_FILE = join(dir, "missing");
    await expect(mintServiceToken({ subject: "u" })).rejects.toThrow(/could not be read/);
  });

  it("never includes secret material in error messages", async () => {
    const path = writeSecret("s7", FILE_SECRET);
    // Empty-file error.
    process.env.DATA_INTELLIGENCE_SIGNING_SECRET_FILE = writeSecret("s8", "");
    const emptyErr = await mintServiceToken({ subject: "u" }).catch((e: Error) => e);
    expect(String(emptyErr)).not.toContain(FILE_SECRET);

    // Unreadable-file error.
    process.env.DATA_INTELLIGENCE_SIGNING_SECRET_FILE = join(dir, "nope");
    process.env.DATA_INTELLIGENCE_SIGNING_SECRET = SECRET;
    const readErr = await mintServiceToken({ subject: "u" }).catch((e: Error) => e);
    expect(String(readErr)).not.toContain(SECRET);
    expect(String(readErr)).not.toContain(FILE_SECRET);

    // Not-configured error names both variables but carries no value.
    delete process.env.DATA_INTELLIGENCE_SIGNING_SECRET_FILE;
    delete process.env.DATA_INTELLIGENCE_SIGNING_SECRET;
    const noneErr = await mintServiceToken({ subject: "u" }).catch((e: Error) => e);
    expect(String(noneErr)).toMatch(/DATA_INTELLIGENCE_SIGNING_SECRET_FILE/);
    expect(String(noneErr)).not.toContain(SECRET);
    expect(String(noneErr)).not.toContain(FILE_SECRET);
    expect(path).toBeTruthy();
  });

  it("re-reads the file each mint so a rotated secret takes effect", async () => {
    const path = writeSecret("rotating", FILE_SECRET);
    process.env.DATA_INTELLIGENCE_SIGNING_SECRET_FILE = path;
    await expect(
      verifyWith(await mintServiceToken({ subject: "u" }), FILE_SECRET),
    ).resolves.toBeTruthy();

    const rotated = `${FILE_SECRET}-rotated`;
    writeFileSync(path, rotated, { encoding: "utf8", mode: 0o600 });
    await expect(
      verifyWith(await mintServiceToken({ subject: "u" }), rotated),
    ).resolves.toBeTruthy();
  });
});
