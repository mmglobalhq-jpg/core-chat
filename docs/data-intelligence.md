# Data Intelligence gateway integration

Core Chat can call the private `data-intelligence-gateway` **server-side only**, to
answer trusted, read-only questions about fund data. The browser never calls the
gateway, never learns its URL, and never sees the signing secret.

This document covers the Core Chat side. The gateway's own rollout lives in
`data-intelligence-gateway/docs/PRODUCTION_ROLLOUT_RUNBOOK.md`.

## Scope: what is and is not integrated

**Stage 5A validates the authenticated `POST /api/query-data` route — and only that
route.**

> **`query_data` is NOT registered with the core-heartbeat chat model.**
> `getQueryDataToolDefinition()` exists and returns a tool descriptor, but nothing
> calls it outside tests. The chat model runs in **`core-heartbeat`**
> (`CORE_API_URL=http://backend:8000`), a different service from this Next.js app.
>
> Enabling both flags therefore does **NOT** make a fund question typed into ordinary
> chat reach the gateway. Do not describe, demo, or sign off Stage 5A as "chat can
> answer fund questions."

**Stage 5B** — registering `query_data` with the core-heartbeat model — is a separate
design, review, and deployment. Natural-language chat integration may only be claimed
after Stage 5B ships.

## Configuration

All variables are **server-only**. None may ever be prefixed `NEXT_PUBLIC_`.

| Variable | Production value | Notes |
| --- | --- | --- |
| `DATA_INTELLIGENCE_ENABLED` | `false` | Master switch; false ⇒ route is 404 |
| `DATA_INTELLIGENCE_FUNDS_ENABLED` | `false` | Funds mode; requires the master switch |
| `DATA_INTELLIGENCE_GATEWAY_URL` | `http://dig:8080` | Internal Compose DNS name |
| `DATA_INTELLIGENCE_SIGNING_SECRET_FILE` | `/run/secrets/dig_service_token_secret` | **Preferred in production** |
| `DATA_INTELLIGENCE_SIGNING_SECRET` | *(unset)* | Local/dev/test fallback only |

**Both flags remain `false` for the initial deployment checkpoint.** They are turned
on only during an attended window, then turned back off.

### Signing secret

The secret must equal the gateway's `DIG_SERVICE_TOKEN_SECRET`. It is a dedicated
signing secret — **never** a database DSN, database-role password, owner credential,
or poller credential. Core Chat never receives the database DSN or any database
password; it only ever holds this signing secret.

`lib/dataIntelligence/serviceToken.ts` resolves it in this order:

1. **`DATA_INTELLIGENCE_SIGNING_SECRET_FILE`** — read synchronously from the given
   path. Authoritative whenever set, so a stale inline value can never mask a broken
   mount. Exactly one trailing newline is stripped; an empty result is rejected; an
   unreadable path raises an error that names the variable but never contains the
   file's contents.
2. **`DATA_INTELLIGENCE_SIGNING_SECRET`** — inline value, for local development and
   tests only, used only when the file variable is unset.

The secret is read on each mint (not cached), so rotating the file takes effect
without a restart. It is never logged, serialized, returned, or included in an error.

In production the file is mounted read-only from the host. The host file is owned
`root:dig-secrets` (gid **10001**) with mode `0640`, and Core Chat runs as
`uid=1000`, so the container needs the supplementary group **10001** (Compose
`group_add`) to read it. That grants read access to that one file without running as
root, without changing the gateway secret's ownership, and without making it
world-readable.

## Token contract

Minted with `jose`, HS256, and verified by the gateway:

| Claim | Value |
| --- | --- |
| `iss` | `core-chat` |
| `aud` | `data-intelligence-gateway` |
| `sub` | the **verified** chat user id (never from the request body) |
| `roles` | `["chat_user"]`, `scope: "funds"`, `token_type: "service"` |
| `exp - iat` | ≤ **120s** (clamped) |
| `jti` | unique per token |

The user's Supabase JWT is never forwarded.

## Request shape

`POST /api/query-data` forwards a natural-language request to the gateway's
`/v1/query`. The gateway's `QueryRequest` is `extra="forbid"` and **requires
`question`** — there is **no `operation` field**:

```json
{"mode":"funds","question":"what funds are tracked?"}
```

The deterministic planner resolves that question to the `list_funds` trusted
operation; the operation name appears in the **response** provenance, never in the
request. `route`/`sql` and any identity fields are stripped before forwarding, so the
caller cannot force generated SQL or spoof identity.

## Stage 5A checkpoint

1. Deploy with **both flags false**. Confirm ordinary chat is unchanged, an
   authenticated `POST /api/query-data` returns **404**, and unauthenticated returns
   **401**.
2. Confirm the signing secret matches the gateway's by comparing **fingerprints
   only** (independently computed truncated SHA-256) — never the values.
3. **Attended window:** set both flags `true`, restart, with operators watching.
4. Canary an authenticated `POST /api/query-data` with the body above. Expect
   `outcome: "answer"` with trusted fund data and provenance: `plan_type:
   "trusted_operation"`, `operation: "list_funds"`, a `catalog_version`, and
   `rpcs_used: ["get_funds"]` — `objects_used` is legitimately **empty** for this
   RPC-backed operation, and `normalized_sql` must be `null`.
5. Also exercise alias resolution, holdings, a comparison with the correct basis, and
   an **abstention** where evidence is insufficient (never a fabricated `verified`).
6. Confirm the browser network tab shows no gateway URL, token, or secret.
7. **Return both flags to `false`** and restart; confirm the route is 404 again.

## Rollback

- **Immediate:** set `DATA_INTELLIGENCE_FUNDS_ENABLED=false` (or
  `DATA_INTELLIGENCE_ENABLED=false`) and restart. `/api/query-data` returns to **404**
  and no tool is exposed.
- **Full:** redeploy the known-good image **`core-chat:096c6b6`**, which contains none
  of this code. Keep that image on the host until Stage 5A is accepted.

Neither path touches the gateway, the database, or `dig_gateway_ro`.

## Stop conditions

Any error in the `/api/query-data` funds path; a missing abstention or a fabricated
`verified`; a provenance or correlation-ID gap; the route reachable while flags are
false; any gateway URL, token, or secret reaching the browser; a signing-secret
fingerprint mismatch; ordinary chat degraded by gateway latency.
