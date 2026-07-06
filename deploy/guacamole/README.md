# Guacamole desktop gateway — scaffold

Stands up Apache Guacamole (`guacd` + `guacamole`) to reach a desktop over RDP/VNC,
fronted later by the existing Cloudflare Tunnel + Access at `desktop.mmglobal.us`.
The Settings modal's admin-only **Desktop** tab opens that URL in a new tab.

**Status: scaffold only.** Nothing here is running. Bringing it up and exposing it
publicly are deliberate, separate steps — see below.

## What's here
- `docker-compose.guacamole.yml` — the two containers; web UI bound to `127.0.0.1:8080`.
- `guacamole-home/user-mapping.xml.template` — parameterized connection (no secrets).
- `guacamole-home/guacamole.properties` — `guacd` wiring.
- `render-config.sh` — renders the template into `user-mapping.xml` (gitignored).

## Required env (master `/home/mmglobal/projects/.env`)
```
RDP_HOST=<reachable RDP/VNC host, e.g. the Windows host IP>
RDP_PORT=3389
RDP_USERNAME=<desktop user>
RDP_PASSWORD=<desktop password>
GUAC_ADMIN_PASSWORD=<Guacamole UI login password>
```
None of these exist yet — a reachable RDP/VNC server is a prerequisite.

## Bring it up (local only)
```
cd deploy/guacamole
set -a; . /home/mmglobal/projects/.env; set +a
./render-config.sh
docker compose -f docker-compose.guacamole.yml up -d
# verify: curl -I http://127.0.0.1:8080/guacamole/
```

## Go public later (NOT done here)
1. Add an ingress rule to the `core-system-tunnel` config:
   `desktop.mmglobal.us -> http://guacamole:8080` (put cloudflared + guacamole on
   the same docker network), via `PUT /accounts/{acct}/cfd_tunnel/{id}/configurations`.
2. Create a proxied CNAME `desktop -> <tunnel-id>.cfargotunnel.com`.
3. Create a Cloudflare Access self-hosted app for `desktop.mmglobal.us` with an
   allow policy for the admin email (same pattern as `chat`/`api`).

## Notes / caveats
- The official `guacamole/guacamole` image is DB-oriented; file auth via
  `user-mapping.xml` + a mounted `GUACAMOLE_HOME` may need entrypoint validation at
  deploy time (or switch to the Postgres/MySQL extension).
- Keep the web UI on `127.0.0.1` — never bind `0.0.0.0`; reach it only through the
  Access-protected tunnel.
