#!/usr/bin/env bash
# First-time (and repeatable) setup of the Hunter n Goose relay on a fresh Ubuntu 24.04 VM.
# Run as root. Safe to run again: every step checks before it changes anything.
#
#   sudo bash setup.sh [--subdomain NAME] [--origins LIST] [--branch BRANCH] [--reconfigure]
#
#   --subdomain NAME  the DuckDNS name without ".duckdns.org" (asked for when missing and not yet set)
#   --origins LIST    comma separated allowed origins
#                     (default: https://hunter-n-goose.pages.dev,https://*.hunter-n-goose.pages.dev)
#   --branch BRANCH   branch of the public repo to run (default: master)
#   --reconfigure     ask for the access codes and the DuckDNS token again and rewrite the settings
#                     (without it, existing /etc/hng-relay.env and /etc/hng-duckdns.token are kept)
#
# Access codes are at least 16 characters (the relay refuses to start with a shorter one). The script
# offers to generate one (openssl rand -base64 18, without / + and =) and shows it once on the terminal
# for you to share; or type your own list.
#
# Environment (optional): HNG_REPO_URL overrides the repo to clone.
#
# Secrets are never taken as arguments (they would land in shell history and `ps`). Typed access codes
# (comma separated, asked twice) and the DuckDNS token are read at a silent prompt, so run this in a
# terminal: ssh -t <vm> sudo bash setup.sh
set -euo pipefail
umask 022
set +x

REPO_URL=${HNG_REPO_URL:-https://github.com/gustav-pjvr/fps-game}
APP_DIR=/opt/hng-relay
APP_USER=hng
RELAY_ENV=/etc/hng-relay.env
CADDY_ENV=/etc/hng-caddy.env
TOKEN_FILE=/etc/hng-duckdns.token
DUCKDNS_BIN=/usr/local/sbin/hng-duckdns-update
ACCESS_CODE_MIN=16
DEFAULT_ORIGINS='https://hunter-n-goose.pages.dev,https://*.hunter-n-goose.pages.dev'
NODE_MAJOR=24
SPARSE_PATHS=(
  /server/
  /src/network/
  /src/core/config.ts
  /src/core/version.ts
  /src/combat/grenades/grenadeTuning.ts
)

SUBDOMAIN=''
ORIGINS=''
BRANCH=master
RECONFIGURE=0

step() { printf '\n==> %s\n' "$*"; }
note() { printf '    %s\n' "$*"; }
die() { printf 'setup.sh: %s\n' "$*" >&2; exit 1; }

usage() { sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; }

while [ $# -gt 0 ]; do
  case $1 in
    --subdomain) [ $# -ge 2 ] || die "--subdomain needs a value"; SUBDOMAIN=$2; shift 2 ;;
    --origins) [ $# -ge 2 ] || die "--origins needs a value"; ORIGINS=$2; shift 2 ;;
    --branch) [ $# -ge 2 ] || die "--branch needs a value"; BRANCH=$2; shift 2 ;;
    --reconfigure) RECONFIGURE=1; shift ;;
    -h | --help) usage; exit 0 ;;
    *) die "unknown argument: $1 (try --help)" ;;
  esac
done

[ "$(id -u)" -eq 0 ] || die "run as root (sudo bash setup.sh)"
command -v apt-get > /dev/null || die "this script is for Ubuntu or Debian (apt)"
[[ $BRANCH =~ ^[A-Za-z0-9._/-]+$ ]] || die "branch name has characters I do not accept"

TMP_FILES=()
cleanup() { [ ${#TMP_FILES[@]} -eq 0 ] || rm -f "${TMP_FILES[@]}"; }
trap cleanup EXIT

# Reads a line without echo into the variable named by $1. $2 is the prompt.
read_secret() {
  local reply
  printf '%s: ' "$2" >&2
  IFS= read -r -s reply || die "no input for: $2"
  printf '\n' >&2
  printf -v "$1" '%s' "$reply"
}

# Writes stdin to $1 as root:root with mode $2, without a moment where it is world readable.
write_file() {
  local dest=$1 mode=$2 tmp
  tmp=$(mktemp "$dest.XXXXXX")
  TMP_FILES+=("$tmp")
  cat > "$tmp"
  chmod "$mode" "$tmp"
  chown root:root "$tmp"
  mv -f "$tmp" "$dest"
}

# ---------------------------------------------------------------- 1. questions first
step "Settings"

if [ -z "$SUBDOMAIN" ] && [ "$RECONFIGURE" -eq 0 ] && [ -f "$CADDY_ENV" ]; then
  existing=$(sed -n 's/^HNG_DOMAIN=//p' "$CADDY_ENV" | head -n 1)
  SUBDOMAIN=${existing%.duckdns.org}
  note "keeping the DuckDNS name from $CADDY_ENV"
fi
if [ -z "$SUBDOMAIN" ]; then
  [ -t 0 ] || die "no --subdomain given and no terminal to ask on"
  read -r -p "DuckDNS subdomain (the part before .duckdns.org): " SUBDOMAIN
fi
SUBDOMAIN=${SUBDOMAIN,,}
SUBDOMAIN=${SUBDOMAIN%.duckdns.org}
[[ $SUBDOMAIN =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$ ]] || die "the DuckDNS subdomain must be letters, digits and hyphens only"
DOMAIN="$SUBDOMAIN.duckdns.org"

NEED_RELAY_ENV=0
if [ ! -f "$RELAY_ENV" ] || [ "$RECONFIGURE" -eq 1 ]; then NEED_RELAY_ENV=1; fi
NEED_TOKEN=0
if [ ! -f "$TOKEN_FILE" ] || [ "$RECONFIGURE" -eq 1 ]; then NEED_TOKEN=1; fi

ACCESS_CODES=''
if [ "$NEED_RELAY_ENV" -eq 1 ]; then
  if [ -z "$ORIGINS" ]; then
    if [ -t 0 ]; then
      read -r -p "Allowed origins, comma separated [$DEFAULT_ORIGINS]: " ORIGINS
    fi
    ORIGINS=${ORIGINS:-$DEFAULT_ORIGINS}
  fi
  ORIGINS=${ORIGINS,,}
  ORIGINS=${ORIGINS// /}
  # Same shape server/config.ts accepts: scheme://[*.]host[:port], no path, no trailing slash.
  IFS=',' read -r -a origin_list <<< "$ORIGINS"
  [ ${#origin_list[@]} -gt 0 ] || die "no allowed origin given"
  for origin in "${origin_list[@]}"; do
    [[ $origin =~ ^https?://(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)*(:[0-9]{1,5})?$ ]] || die "not an origin like https://example.com or https://*.example.com: $origin"
  done

  generate=''
  read -r -p "Generate a new random access code? Answer n to type your own list instead [Y/n]: " generate || die "no answer to the access code question"
  if [[ ${generate,,} =~ ^(y|yes)?$ ]]; then
    if command -v openssl > /dev/null; then
      ACCESS_CODES=$(openssl rand -base64 18 | tr -d '/+=\n')
    else
      ACCESS_CODES=$(head -c 18 /dev/urandom | base64 | tr -d '/+=\n')
    fi
    [ ${#ACCESS_CODES} -ge "$ACCESS_CODE_MIN" ] || die "the generated code came out too short; run again"
    # Shown once, on the terminal (stderr, like the prompts), so it can be shared now.
    printf '\nThe new access code, shown only this once (it is stored only on this VM):\n\n    %s\n\n' "$ACCESS_CODES" >&2
    printf 'Copy it now and share it with your friends. It replaces every earlier code.\n' >&2
  else
    printf 'Access codes: one or more, comma separated, each at least %s characters, letters digits and . _ ~ + = : @ %% ^ ! * - only.\n' "$ACCESS_CODE_MIN" >&2
    read_secret ACCESS_CODES "Access code(s) (hidden)"
    read_secret again "Access code(s) again (hidden)"
    [ "$ACCESS_CODES" = "$again" ] || die "the two entries differ"
    unset again
  fi
  unset generate
  [ -n "$ACCESS_CODES" ] || die "at least one access code is required"
  codes_re='^[A-Za-z0-9._~+=:@%^!*-]+(,[A-Za-z0-9._~+=:@%^!*-]+)*$'
  [[ $ACCESS_CODES =~ $codes_re ]] || die "the access codes contain a character I do not accept, or an empty entry"
  IFS=',' read -r -a code_list <<< "$ACCESS_CODES"
  for code in "${code_list[@]}"; do
    [ ${#code} -le 128 ] || die "each access code must be at most 128 characters"
    [ ${#code} -ge "$ACCESS_CODE_MIN" ] || die "each access code must be at least $ACCESS_CODE_MIN characters (answer y at the first question to generate one)"
  done
  unset code_list code
fi

TOKEN=''
if [ "$NEED_TOKEN" -eq 1 ]; then
  read_secret TOKEN "DuckDNS token (hidden)$([ -f "$TOKEN_FILE" ] && printf ', empty keeps the current one')"
  if [ -z "$TOKEN" ]; then
    [ -f "$TOKEN_FILE" ] || die "the DuckDNS token is required"
    NEED_TOKEN=0
  else
    [[ $TOKEN =~ ^[A-Za-z0-9-]+$ ]] || die "a DuckDNS token is letters, digits and hyphens only"
  fi
fi

# ---------------------------------------------------------------- 2. packages
step "System updates and base packages"
export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a
apt-get update -y
apt-get upgrade -y
apt-get install -y ca-certificates curl gnupg git cron unattended-upgrades apt-transport-https debian-keyring debian-archive-keyring

step "Automatic security updates (reboot when needed at 02:00 UTC, which is 04:00 SAST)"
write_file /etc/apt/apt.conf.d/20auto-upgrades 644 << 'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
write_file /etc/apt/apt.conf.d/52hng-unattended-upgrades 644 << 'EOF'
// The VM clock is UTC: 02:00 here is 04:00 in South Africa.
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "02:00";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
EOF

step "Node.js $NODE_MAJOR (NodeSource apt repository, major version pinned)"
install -d -m 755 /usr/share/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/nodesource.gpg
chmod 644 /usr/share/keyrings/nodesource.gpg
printf 'deb [arch=%s signed-by=/usr/share/keyrings/nodesource.gpg] https://deb.nodesource.com/node_%s.x nodistro main\n' "$(dpkg --print-architecture)" "$NODE_MAJOR" > /etc/apt/sources.list.d/nodesource.list
apt-get update -y
apt-get install -y nodejs
node_major_found=$(node -p 'process.versions.node.split(".")[0]')
[ "$node_major_found" = "$NODE_MAJOR" ] || die "expected Node $NODE_MAJOR, found $(node --version)"
note "node $(node --version) at $(command -v node)"
[ "$(command -v node)" = /usr/bin/node ] || die "node is not at /usr/bin/node, which the service unit expects"

step "Caddy (official apt repository)"
curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
chmod 644 /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' -o /etc/apt/sources.list.d/caddy-stable.list
chmod 644 /etc/apt/sources.list.d/caddy-stable.list
apt-get update -y
apt-get install -y caddy

# ---------------------------------------------------------------- 3. firewall
step "Firewall: open TCP 80 and 443 in iptables and keep it across reboots"
# Oracle's Ubuntu images end the INPUT chain with a REJECT rule, so new ACCEPT rules go in front of it.
# (The cloud-side security list must allow 80 and 443 as well: see README.md.)
echo 'iptables-persistent iptables-persistent/autosave_v4 boolean true' | debconf-set-selections
echo 'iptables-persistent iptables-persistent/autosave_v6 boolean true' | debconf-set-selections
apt-get install -y iptables iptables-persistent netfilter-persistent
for port in 80 443; do
  if ! iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2> /dev/null; then
    reject_line=$(iptables -L INPUT --line-numbers -n | awk '!found && $2 == "REJECT" { print $1; found = 1 }')
    if [ -n "$reject_line" ]; then
      iptables -I INPUT "$reject_line" -p tcp --dport "$port" -j ACCEPT
    else
      iptables -A INPUT -p tcp --dport "$port" -j ACCEPT
    fi
    note "opened tcp/$port"
  else
    note "tcp/$port already open"
  fi
done
netfilter-persistent save

# ---------------------------------------------------------------- 4. app
step "User $APP_USER and the app in $APP_DIR"
if ! id "$APP_USER" > /dev/null 2>&1; then
  useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin "$APP_USER"
fi

if [ ! -d "$APP_DIR/.git" ]; then
  [ ! -e "$APP_DIR" ] || [ -z "$(ls -A "$APP_DIR")" ] || die "$APP_DIR exists and is not an empty git checkout"
  git clone --filter=blob:none --no-checkout --depth 1 --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi
git -C "$APP_DIR" sparse-checkout set --no-cone "${SPARSE_PATHS[@]}"
git -C "$APP_DIR" fetch --depth 1 origin "$BRANCH"
git -C "$APP_DIR" checkout -f -B "$BRANCH" FETCH_HEAD
# Root owns the code; the service user only reads it.
chown -R root:root "$APP_DIR"
note "at $(git -C "$APP_DIR" rev-parse --short HEAD) on branch $BRANCH"
for needed in server/main.ts server/package-lock.json server/deploy/hng-relay.service server/deploy/Caddyfile server/deploy/caddy-hng.conf server/deploy/duckdns-update.sh; do
  [ -f "$APP_DIR/$needed" ] || die "$needed is missing from branch $BRANCH (is the deploy kit merged into it?)"
done

step "Dependencies (npm ci --omit=dev --ignore-scripts)"
# --ignore-scripts: no install script from a package runs as root.
(cd "$APP_DIR/server" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund)

# ---------------------------------------------------------------- 5. configuration and secrets
step "Configuration"
if [ "$NEED_RELAY_ENV" -eq 1 ]; then
  write_file "$RELAY_ENV" 600 << EOF
HNG_ACCESS_CODES="$ACCESS_CODES"
HNG_ALLOWED_ORIGINS="$ORIGINS"
HNG_HOST=127.0.0.1
HNG_PORT=8080
HNG_MAX_ROOMS=50
HNG_MAX_PLAYERS_PER_ROOM=4
HNG_LOG_LEVEL=info
EOF
  ACCESS_CODES=''
  note "wrote $RELAY_ENV (root, mode 600)"
else
  note "keeping existing $RELAY_ENV (use --reconfigure to change the codes or origins)"
  chown root:root "$RELAY_ENV"
  chmod 600 "$RELAY_ENV"
fi

if [ "$NEED_TOKEN" -eq 1 ]; then
  printf '%s\n' "$TOKEN" | write_file "$TOKEN_FILE" 600
  TOKEN=''
  note "wrote $TOKEN_FILE (root, mode 600)"
else
  chown root:root "$TOKEN_FILE"
  chmod 600 "$TOKEN_FILE"
fi

# The domain is not a secret. Caddy gets it as an environment variable through a systemd drop-in
# (server/deploy/caddy-hng.conf, which reads $CADDY_ENV), which also gives Caddy /run/caddy for its
# admin socket and points `systemctl reload caddy` at it.
printf 'HNG_DOMAIN=%s\n' "$DOMAIN" | write_file "$CADDY_ENV" 644
install -d -m 755 /etc/systemd/system/caddy.service.d
install -m 644 -o root -g root "$APP_DIR/server/deploy/caddy-hng.conf" /etc/systemd/system/caddy.service.d/hng.conf

# Keep the journal (where the relay logs) to 200 MB.
install -d -m 755 /etc/systemd/journald.conf.d
write_file /etc/systemd/journald.conf.d/hng.conf 644 << 'EOF'
[Journal]
SystemMaxUse=200M
EOF
systemctl restart systemd-journald

# ---------------------------------------------------------------- 6. DuckDNS
step "DuckDNS updater (root cron, every 5 minutes)"
install -m 755 -o root -g root "$APP_DIR/server/deploy/duckdns-update.sh" "$DUCKDNS_BIN"
touch /var/log/hng-duckdns.log
chown root:root /var/log/hng-duckdns.log
chmod 600 /var/log/hng-duckdns.log
write_file /etc/cron.d/hng-duckdns 644 << EOF
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
*/5 * * * * root $DUCKDNS_BIN > /dev/null 2>&1
EOF
if "$DUCKDNS_BIN"; then
  note "DuckDNS accepted the update for $DOMAIN"
else
  die "DuckDNS did not answer OK for $DOMAIN: check the subdomain and the token (see /var/log/hng-duckdns.log)"
fi

# ---------------------------------------------------------------- 7. services
step "systemd unit and Caddyfile"
install -m 644 -o root -g root "$APP_DIR/server/deploy/hng-relay.service" /etc/systemd/system/hng-relay.service
if [ -f /etc/caddy/Caddyfile ] && [ ! -f /etc/caddy/Caddyfile.orig ]; then
  cp -p /etc/caddy/Caddyfile /etc/caddy/Caddyfile.orig
fi
install -m 644 -o root -g root "$APP_DIR/server/deploy/Caddyfile" /etc/caddy/Caddyfile
runuser -u caddy -- env "HNG_DOMAIN=$DOMAIN" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile > /dev/null
note "Caddyfile is valid"
systemctl daemon-reload

step "Starting the relay and Caddy"
systemctl enable hng-relay caddy > /dev/null
systemctl restart hng-relay
systemctl restart caddy
sleep 2
systemctl is-active --quiet hng-relay || die "hng-relay did not start: journalctl -u hng-relay -n 30 --no-pager"
systemctl is-active --quiet caddy || die "caddy did not start: journalctl -u caddy -n 30 --no-pager"
note "local health: $(curl -fsS --max-time 5 http://127.0.0.1:8080/healthz || echo 'no answer')"

# ---------------------------------------------------------------- 8. public check
step "Waiting for https://$DOMAIN/healthz (the certificate can take a minute)"
result=''
for _ in $(seq 1 40); do
  if result=$(curl -fsS --max-time 10 "https://$DOMAIN/healthz" 2> /dev/null); then
    printf '\nhttps://%s/healthz answered:\n%s\n' "$DOMAIN" "$result"
    printf '\nDone. In the game, the relay is wss://%s/ws\n' "$DOMAIN"
    exit 0
  fi
  sleep 5
done
printf '\nNo answer from https://%s/healthz after about 3 minutes.\n' "$DOMAIN" >&2
printf 'Check: DNS (dig +short %s), the cloud security list for TCP 80 and 443, and\n' "$DOMAIN" >&2
printf '  journalctl -u caddy -n 50 --no-pager\n  journalctl -u hng-relay -n 50 --no-pager\n' >&2
exit 1
