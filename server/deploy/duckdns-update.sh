#!/usr/bin/env bash
# Keeps the DuckDNS name pointed at this VM. setup.sh installs it as /usr/local/sbin/hng-duckdns-update
# and runs it from /etc/cron.d every 5 minutes, as root.
#
# Reads: /etc/hng-caddy.env (HNG_DOMAIN=<name>.duckdns.org) and /etc/hng-duckdns.token (root, mode 600).
# Writes one line per run to /var/log/hng-duckdns.log (root only). The token is never printed or logged,
# and it is handed to curl on stdin so it does not appear in the process list.
set -euo pipefail
umask 077

CADDY_ENV=/etc/hng-caddy.env
TOKEN_FILE=/etc/hng-duckdns.token
LOG=/var/log/hng-duckdns.log

HNG_DOMAIN=$(sed -n 's/^HNG_DOMAIN=//p' "$CADDY_ENV" | head -n 1)
sub=${HNG_DOMAIN%.duckdns.org}
token=$(head -n 1 "$TOKEN_FILE")

if [[ ! $sub =~ ^[a-z0-9-]+$ || ! $token =~ ^[A-Za-z0-9-]+$ ]]; then
  printf '%s config error: subdomain or token file is malformed\n' "$(date -u +%FT%TZ)" >> "$LOG"
  exit 1
fi

# An empty ip= makes DuckDNS use the address the request comes from.
if result=$(printf 'url = "https://www.duckdns.org/update?domains=%s&token=%s&ip="\n' "$sub" "$token" | curl -sS --max-time 20 -K - 2>/dev/null); then
  :
else
  result="curl failed"
fi
printf '%s %s\n' "$(date -u +%FT%TZ)" "$result" >> "$LOG"
# Keep the log small.
if [ "$(wc -l < "$LOG")" -gt 1000 ]; then
  tail -n 500 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
fi
[ "$result" = "OK" ]
