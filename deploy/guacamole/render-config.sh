#!/usr/bin/env bash
# Render guacamole-home/user-mapping.xml from the template, injecting the RDP_*
# and GUAC_ADMIN_PASSWORD secrets from the environment. Source the master .env
# first so nothing is hardcoded:
#
#   set -a; . /home/mmglobal/projects/.env; set +a
#   ./render-config.sh
#
# The rendered user-mapping.xml contains real passwords and is gitignored.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"

: "${RDP_HOST:?set RDP_HOST in the environment}"
: "${RDP_USERNAME:?set RDP_USERNAME in the environment}"
: "${RDP_PASSWORD:?set RDP_PASSWORD in the environment}"
: "${GUAC_ADMIN_PASSWORD:?set GUAC_ADMIN_PASSWORD in the environment}"
export RDP_HOST RDP_USERNAME RDP_PASSWORD GUAC_ADMIN_PASSWORD RDP_PORT="${RDP_PORT:-3389}"

envsubst < "$here/guacamole-home/user-mapping.xml.template" > "$here/guacamole-home/user-mapping.xml"
chmod 600 "$here/guacamole-home/user-mapping.xml"
echo "rendered guacamole-home/user-mapping.xml (gitignored, mode 600)"
