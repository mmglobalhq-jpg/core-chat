# Guacamole desktop gateway

Apache Guacamole (`guacd` + `guacamole`) providing browser-based RDP access to the
Windows host, published at `desktop.mmglobal.us` through the existing Cloudflare
Tunnel. The Settings modal's admin-only **Desktop** tab opens that URL in a new tab.

**Status: LIVE in production.**

## Access architecture

```
DESKTOP_ACCESS_ARCHITECTURE=GUACAMOLE_PASSWORD_ONLY
```

**Owner-approved decision (2026-08-04).** `desktop.mmglobal.us` **intentionally
exposes the Guacamole login page directly to the public internet**. Guacamole's own
authentication is the web access control. There is **no Cloudflare Access
application configured for this hostname** — this is deliberate, not an oversight or
a regression.

Two independent credentials are required to reach a desktop:

| Layer | Credential | Purpose |
| --- | --- | --- |
| 1 — web | Guacamole `admin` login (`user-mapping.xml`) | reach the Guacamole UI |
| 2 — desktop | Windows/RDP username + password | open the actual RDP session |

The RDP credential is a **separate second credential** and is not derivable from the
Guacamole login.

> **No password value is recorded in this repository.** The rendered
> `user-mapping.xml` holds the real credentials, is `.gitignore`d, and is mode
> `0640`. Only `user-mapping.xml.template` is tracked.

**Accepted risk.** This design has no Cloudflare MFA, no Cloudflare identity
restriction, and a publicly reachable login page. The owner has explicitly accepted
that trade-off. See `system-source-of-truth/docs/18-risk-register.md` → R-01.

## What's here

- `docker-compose.guacamole.yml` — the two containers; web UI bound to `127.0.0.1:8080`.
- `guacamole-home/user-mapping.xml.template` — parameterized connection (no secrets).
- `guacamole-home/guacamole.properties` — `guacd` wiring.
- `render-config.sh` — renders the template into `user-mapping.xml` (gitignored).

## Required env (master `/home/mmglobal/projects/.env`)

```
RDP_HOST=<Windows host IP>
RDP_PORT=3389
RDP_USERNAME=<desktop user>
RDP_PASSWORD=<desktop password>
GUAC_ADMIN_PASSWORD=<Guacamole UI login password>
```

`GUAC_ADMIN_PASSWORD` is the **canonical** source. Changing the Guacamole password
means updating it here *and* re-rendering — otherwise a later render silently
restores the previous password.

## Change the Guacamole password

Never pass the password as a command argument. Enter it interactively:

```bash
set -a; . /home/mmglobal/projects/.env; set +a          # RDP_* first
read -rs -p "New Guacamole admin password: " GUAC_ADMIN_PASSWORD && echo
export GUAC_ADMIN_PASSWORD
# ... update GUAC_ADMIN_PASSWORD in /home/mmglobal/projects/.env, then:
./render-config.sh
unset GUAC_ADMIN_PASSWORD
docker restart guacamole
```

Verify with `POST /api/tokens` on `127.0.0.1:8080`: the new password returns HTTP 200
with an `authToken`; the old one returns HTTP 403.

## ⚠️ Do not "harden" user-mapping.xml to 0600

The `0640` mode is **load-bearing**. The image runs as **uid 1001** while the file is
owned by **uid 1000**. A plain `chmod 600` puts Guacamole into a crash loop:

```
cp: cannot open '/etc/guacamole/./user-mapping.xml': Permission denied
```

Read access for uid 1001 is granted by `group_add: ["1000"]` in the compose file —
the same pattern the dig gateway uses. Keep **both** `0640` and `group_add`.

## Operations

```bash
cd deploy/guacamole
docker compose -f docker-compose.guacamole.yml up -d      # bring up
docker restart guacamole                                  # reload user-mapping.xml
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/   # expect 200
```

The web UI stays bound to `127.0.0.1` — never `0.0.0.0`. Public reachability comes
solely from the cloudflared ingress rule `desktop.mmglobal.us -> http://guacamole:8080`.

## Notes / caveats

- File authentication via `user-mapping.xml` (no database extension). Guacamole file
  auth has **no rate limiting and no account lockout** — materially relevant now that
  the login page is public.
- The password is stored without an `encoding` attribute, i.e. plaintext in the
  rendered file. Mode `0640` is the only protection at rest. Consider
  `encoding="sha256"`.
- `guacamole/guacamole:1.5.5` and `guacd:1.5.5` are ~2 years old — upgrade pending
  (risk register R-21).
- `ignore-cert: true` on the RDP connection — no RDP server identity validation
  (finding A-13).
