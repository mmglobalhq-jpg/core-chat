// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { jwtVerify } from "jose";
import { mintServiceToken } from "@/lib/dataIntelligence/serviceToken";

const SECRET = "unit-test-shared-signing-secret-000000000000";

describe("mintServiceToken", () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.DATA_INTELLIGENCE_SIGNING_SECRET;
    process.env.DATA_INTELLIGENCE_SIGNING_SECRET = SECRET;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.DATA_INTELLIGENCE_SIGNING_SECRET;
    else process.env.DATA_INTELLIGENCE_SIGNING_SECRET = saved;
  });

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
