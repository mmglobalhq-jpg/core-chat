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

## Consumer

Single consumer, single source.

| | |
| --- | --- |
| Variable | `FUNDS_SUPABASE_SERVICE_ROLE_KEY` (+ `FUNDS_SUPABASE_URL`) |
| Client | `lib/supabaseFunds.ts` (`@supabase/supabase-js` 2.110.0) |
| Call sites | `lib/fundsRpc.ts` (`callRpc`), `app/api/funds/export/route.ts` |
| Service / container | `frontend` / `core-chat` |
| Stored in | `/home/mmglobal/projects/.env` **only**, injected via compose `environment:` |
| Server-only | yes — browser-import guard; never `NEXT_PUBLIC_` |
| Build arg | no — runtime only |

Because it is runtime-only, **rotation needs a `frontend` recreate, not a rebuild.**
(The compatibility code in step 1 does need one rebuild, once.)

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
   body: {"p_manager": …, "p_fund": …, "p_start_date": …, "p_end_date": …, "p_page": 1}
   ```
   **Expect HTTP 200 with a JSON array** — this is what proves an opaque key resolves
   the role without a Bearer header. **Prohibited:** `Authorization: Bearer <key>`.
5. **Back up** `/home/mmglobal/projects/.env` to a protected path outside all
   repositories (mode `0600`), and confirm it is byte-identical.
6. **Replace only `FUNDS_SUPABASE_SERVICE_ROLE_KEY`** in
   `/home/mmglobal/projects/.env`, atomically (temp file + rename), preserving owner
   and mode. Change no other variable, and no other env file.
7. **Recreate `frontend` only** — no rebuild, and do not recreate `backend`,
   `graph-rag`, `graph-rag-sidecar`, `cloudflared`, or the gateway.
8. **Verify** — `/funds` loads; `/api/funds/export` returns rows (populated data, not
   merely HTTP 200); logs clean of `401`, `403`, `PGRST`, `permission denied`.
9. **Soak** several hours under real traffic, then re-run the step-8 canaries.
10. **Revoke** the legacy key only after step 9 passes, then **re-run the canaries
    immediately** — that is what proves nothing was still using the old key.

## Rollback (before revocation)

Restore the backed-up `.env` and recreate `frontend`. The dual-format code still
supports the legacy key, so **no image rollback is needed**. The legacy key stays
valid until explicitly revoked; once revoked it cannot be restored, so never revoke
before step 9 passes.

After revocation the backup is no longer a functional rollback path — relabel it as
historical evidence and take a fresh post-rotation backup.

## Stop conditions

The probe returns anything other than 200; any funds RPC returns `401`, `403`, or a
`PGRST` role error; `/funds` or the export route returns empty where it previously
returned rows; any key value appears in output or logs; any unrelated service is
disturbed. On any of these, halt and keep the legacy key active — do not revoke.
