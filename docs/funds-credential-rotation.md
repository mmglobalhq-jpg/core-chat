# FUNDS Supabase credential rotation

How to rotate `FUNDS_SUPABASE_SERVICE_ROLE_KEY` from a legacy JWT service-role key to
a current `sb_secret_*` secret key, without a flag day.

This mirrors the REITS rotation, which is already complete — see
`core-heartbeat/docs/reit-research-tools.md` → *Rotating to an `sb_secret_*` key*.

## Project identity

`FUNDS_SUPABASE_URL` points at Supabase project **`rfkyvxfzixgiczwgyrgn`**
("PROJECT-A"). This is the **same project** used by:

- REITS research (`REITS_SUPABASE_*`, already on an `sb_secret_*` key);
- the Graph-RAG service (`SUPABASE_URL` / `SUPABASE_SERVICE_KEY` in
  `graph-rag-service/.env.local`);
- the data-intelligence gateway, via the least-privilege role `dig_gateway_ro`.

It is **not** the Core Chat project (`ulzhtdnjwikcadtskzgi`, "PROJECT-B"), which backs
auth/profiles. Do not conflate the two: several variables share generic names
(`SUPABASE_URL`, `SUPABASE_ANON_KEY`) across env files while holding values for
*different* projects.

### Use a dedicated key — do not reuse the REITS key

Create a new secret key named **`funds-reader-projA`**.

There is **no technical dependency** requiring key reuse: the two consumers hit the
same project but disjoint object sets (funds/holdings RPCs vs
`reit_research_*_v1`). Separate keys keep blast radius and audit trails distinct, so
one compromised or rotated key never forces the other to move. The name encodes the
project because the consumer name alone (`funds`) is what caused the Graph-RAG
project-identity confusion in the first place.

## Consumers and where the key actually lives

> **Corrected 2026-10-25.** This section used to say *"single consumer"* and
> *"stored in `~/projects/.env` only, injected via compose `environment:`"*. Both
> stopped being true when secrets moved to mounted files: compose now **blanks** the
> env var and the apps read a file. Following the old steps would have rotated a copy
> nothing reads, left both consumers on the old key, and broken them both the moment
> it was revoked.

**The live key is the file `/etc/core-heartbeat/secrets/funds_service_role_key`**
(root, `0640`), mounted read-only into both containers. It is generated from
`~/projects/.env` by `~/install-secret-files.sh`, so `.env` is the *input* to the
file, not what the apps read. `FUNDS_SUPABASE_URL` is still a plain env var from
`~/projects/.env`.

| | `frontend` / `core-chat` | `backend` / `core-heartbeat` |
| --- | --- | --- |
| Use | Fund Manager `/api/funds/*` | `/health/fund-pollers` (and so watchdog check 5) |
| Code | `lib/supabaseFunds.ts` via `lib/serverSecret.ts` | `services/fund_pollers.py` via `services/secrets.py` |
| Reads | `FUNDS_SUPABASE_SERVICE_ROLE_KEY_FILE` → `/run/secrets/keys/funds_service_role_key` | `FUNDS_SUPABASE_SERVICE_ROLE_KEY_FILE` → `/run/secrets/funds_service_role_key` |
| Caches the key | yes — the client is built once per process | yes — `services/secrets.py` caches file contents |
| `sb_secret_*` aware | yes (drops `Authorization`) | yes (drops `Authorization`) |

Both cache, so after the file changes **both containers must be restarted**. Neither
needs a rebuild: the key is runtime-only, never a build arg, never `NEXT_PUBLIC_`.

## Auth header contract

| Key format | `apikey` | `Authorization: Bearer` |
| --- | --- | --- |
| legacy JWT service-role key | required | **required** |
| `sb_secret_*` (opaque) | required | **must be omitted** |

Legacy keys need both: PostgREST resolves the role from the Bearer JWT, and with
`apikey` alone the request is admitted but runs as `anon`, which holds no grant on
the poller RPCs. This was verified in production on the sibling REITS client, which
returned `401 permission denied for function` when `Authorization` was dropped.

`sb_secret_*` keys are opaque, not JWTs, so putting one in `Authorization` risks
rejection as an invalid JWT.

supabase-js sends **both** headers for every key shape and does not detect the new
format, so `lib/supabaseFunds.ts` installs a scoped `global.fetch` wrapper that
removes **only** `Authorization`, and **only** when the key starts with `sb_secret_`.
Global fetch is never mutated. Pinned by
`lib/__tests__/supabaseFunds.headers.test.ts`.

## Rotation sequence

Deploy the compatibility code **first**, while the legacy key is still active. That
is what removes the flag day: after step 2 the running code supports both
generations, so the key swap is the only remaining variable.

**No key may appear in a command line, terminal output, log, or shell history** —
read it from a protected file (mode `0600`, removed afterward) or a secure prompt.

1. **Deploy the dual-format code** (this change) with the **legacy key unchanged**.
   Requires a `core-chat` rebuild; `NEXT_PUBLIC_SUPABASE_URL` /
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` build args come from `/home/mmglobal/projects/.env`.
2. **Verify on the legacy key** — `/funds` loads and `/api/funds/export` returns rows.
   This proves the change is a no-op before any credential moves.
3. **Create** the `funds-reader-projA` secret key. Leave the legacy key active.
4. **Probe the new key, `apikey` only**, before editing anything:
   ```
   POST <FUNDS_SUPABASE_URL>/rest/v1/rpc/get_fund_position_changes
   apikey: <new sb_secret key>
   content-type: application/json
   body: {"p_lookback": 1, "p_page": 1}
   ```
   **Expect HTTP 200 with a JSON object** carrying `changes`, `fund_status` and
   `pagination` — this is what proves an opaque key resolves the role without a
   Bearer header. **Prohibited:** `Authorization: Bearer <key>`.
5. **Back up** `/home/mmglobal/projects/.env` **and**
   `/etc/core-heartbeat/secrets/funds_service_role_key` to a protected path outside
   all repositories (mode `0600`), and confirm both are byte-identical.
6. **Replace only `FUNDS_SUPABASE_SERVICE_ROLE_KEY`** in
   `/home/mmglobal/projects/.env`, atomically (temp file + rename), preserving owner
   and mode. Change no other variable, and no other env file.
7. **Regenerate the mounted file:** `sudo ~/install-secret-files.sh`, then
   `sudo ~/install-secret-files.sh --check` — it compares file against env by hash and
   prints no secret. Editing `.env` alone changes nothing the apps read.
8. **Restart both consumers** — `frontend` and `backend`, no rebuild (both cache the
   key in-process). Use both compose files
   (`docker compose -f docker-compose.yml -f ~/.rollout-deploy-override.yml up -d
   --force-recreate frontend backend`). Do not touch `graph-rag`, `graph-rag-sidecar`,
   `cloudflared`, or the gateway.
9. **Verify** — `/funds` loads; `/api/funds/export` returns rows (populated data, not
   merely HTTP 200); `curl -s 127.0.0.1:8000/health/fund-pollers` reports
   `healthy: true` rather than `unknown` for all three pollers; logs clean of `401`,
   `403`, `PGRST`, `permission denied`.
10. **Soak** several hours under real traffic, then re-run the step-9 canaries.
11. **Revoke** the legacy key only after step 10 passes, then **re-run the canaries
    immediately** — that is what proves nothing was still using the old key.

## Rollback (before revocation)

Restore the backed-up `.env` and secret file (or restore `.env` and re-run
`install-secret-files.sh`), then restart `frontend` and `backend`. The dual-format code still
supports the legacy key, so **no image rollback is needed**. The legacy key stays
valid until explicitly revoked; once revoked it cannot be restored, so never revoke
before step 10 passes.

After revocation the backup is no longer a functional rollback path — relabel it as
historical evidence and take a fresh post-rotation backup.

## Stop conditions

The probe returns anything other than 200; any funds RPC returns `401`, `403`, or a
`PGRST` role error; `/funds` or the export route returns empty where it previously
returned rows; any key value appears in output or logs; any unrelated service is
disturbed. On any of these, halt and keep the legacy key active — do not revoke.
