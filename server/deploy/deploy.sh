#!/usr/bin/env bash
# Update the relay on the VM from your own machine (Git Bash on Windows works).
#
#   server/deploy/deploy.sh <ssh-target> [--commit SHA] [--force]
#
#   <ssh-target>  user@host of the VM, for example ubuntu@<vm-ip> (a name from ~/.ssh/config works too)
#   --commit SHA  the full commit the VM must end up on (default: HEAD of your local checkout)
#   --force       do not wait for the rooms to empty: players in a match are disconnected
#
# Environment (optional): HNG_SSH_KEY is the private key to use (default ~/.ssh/hng_relay_ed25519).
#
# On the VM it fetches the branch already checked out in /opt/hng-relay and goes on only if the
# branch tip is exactly the expected commit (push first): otherwise nothing on the VM changes. Then
# it runs npm ci --omit=dev --ignore-scripts, installs a changed unit, Caddy drop-in or Caddyfile,
# waits until /healthz reports rooms: 0 (up to 10 minutes), restarts the service and checks
# /healthz (straight on 127.0.0.1:8080, which alone shows the version and the counts). It never
# prints the env file.
set -euo pipefail

usage() { sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; }

target=''
force=0
commit=''
while [ $# -gt 0 ]; do
  case $1 in
    --force) force=1; shift ;;
    --commit)
      [ $# -ge 2 ] || { printf 'deploy.sh: --commit needs a value\n' >&2; exit 2; }
      commit=$2
      shift 2
      ;;
    -h | --help) usage; exit 0 ;;
    -*) printf 'deploy.sh: unknown option %s\n' "$1" >&2; exit 2 ;;
    *)
      [ -z "$target" ] || { printf 'deploy.sh: more than one target given\n' >&2; exit 2; }
      target=$1
      shift
      ;;
  esac
done
[ -n "$target" ] || { usage >&2; exit 2; }

# The commit the VM must run: what you have checked out here (and pushed), unless --commit says.
if [ -z "$commit" ]; then
  commit=$(git -C "$(dirname "$0")" rev-parse HEAD) || { printf 'deploy.sh: cannot read the local commit; pass --commit SHA\n' >&2; exit 2; }
fi
commit=$(printf '%s' "$commit" | tr 'A-F' 'a-f')
[[ $commit =~ ^[0-9a-f]{40}$ ]] || { printf 'deploy.sh: --commit must be a full 40-character commit hash\n' >&2; exit 2; }
printf 'Deploying commit %s\n' "$commit"

key=${HNG_SSH_KEY:-$HOME/.ssh/hng_relay_ed25519}
[ -f "$key" ] || { printf 'deploy.sh: SSH key not found: %s (set HNG_SSH_KEY to use another)\n' "$key" >&2; exit 1; }

ssh_opts=(-i "$key" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30 -o ServerAliveCountMax=6)

# The whole remote script is one function that is called on the last line, so bash has read all of
# it before any command can touch stdin. Every command inside also reads from /dev/null.
ssh "${ssh_opts[@]}" "$target" "bash -s -- $force $commit" << 'REMOTE'
main() {
  force=$1
  expected=$2
  app=/opt/hng-relay
  say() { printf '==> %s\n' "$*"; }

  health() { curl -fsS --max-time 5 http://127.0.0.1:8080/healthz; }
  # field NAME < json: prints one field of the /healthz JSON.
  field() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s)[process.argv[1]])}catch{console.log("?")}})' "$1"; }

  # The relay refuses to start with a missing access code or one under 16 characters. Check this
  # first, without showing a code, before anything on the VM changes: otherwise new code would sit on
  # disk beside a code it rejects, and the next reboot or crash would leave the relay down. Quoted
  # and unquoted values are both read.
  if ! sudo awk '/^HNG_ACCESS_CODES=/ { found = 1; v = substr($0, index($0, "=") + 1); gsub(/"/, "", v); n = split(v, codes, ","); kept = 0; for (i = 1; i <= n; i++) { c = codes[i]; gsub(/^[ \t]+|[ \t]+$/, "", c); if (c == "") continue; kept++; if (length(c) < 16) short = 1 } if (kept == 0) short = 1 } END { exit (short || !found) }' /etc/hng-relay.env; then
    say "/etc/hng-relay.env has no access code, or one shorter than 16 characters, which the relay does not accept."
    say "Run setup.sh --reconfigure on the VM first (it can generate a code). Nothing on the VM changed."
    return 5
  fi

  branch=$(sudo git -C "$app" rev-parse --abbrev-ref HEAD)
  before=$(sudo git -C "$app" rev-parse --short HEAD)

  say "Fetching branch $branch (now at $before)"
  sudo git -C "$app" fetch --depth 1 origin "$branch" || return 1
  fetched=$(sudo git -C "$app" rev-parse FETCH_HEAD) || return 1
  # Nothing from the repo runs or is installed as root unless it is the commit you deploy.
  if [ "$fetched" != "$expected" ]; then
    say "The tip of $branch is $fetched, not the expected $expected."
    say "Push your commit first (or pass --commit for the one you mean). Nothing on the VM changed."
    return 4
  fi
  sudo git -C "$app" reset --hard FETCH_HEAD || return 1
  head_now=$(sudo git -C "$app" rev-parse HEAD) || return 1
  if [ "$head_now" != "$expected" ]; then
    say "HEAD is $head_now after the checkout, not $expected. Not restarting."
    return 4
  fi
  after=$(sudo git -C "$app" rev-parse --short HEAD)
  say "At $after"

  say "Installing dependencies (no install scripts)"
  (cd "$app/server" && sudo npm ci --omit=dev --ignore-scripts --no-audit --no-fund) || return 1

  if ! sudo cmp -s "$app/server/deploy/hng-relay.service" /etc/systemd/system/hng-relay.service; then
    say "Service unit changed: installing it"
    sudo install -m 644 -o root -g root "$app/server/deploy/hng-relay.service" /etc/systemd/system/hng-relay.service || return 1
    sudo systemctl daemon-reload || return 1
  fi
  caddy_changed=0
  if ! sudo cmp -s "$app/server/deploy/caddy-hng.conf" /etc/systemd/system/caddy.service.d/hng.conf; then
    say "Caddy drop-in changed: installing it"
    sudo install -d -m 755 /etc/systemd/system/caddy.service.d || return 1
    sudo install -m 644 -o root -g root "$app/server/deploy/caddy-hng.conf" /etc/systemd/system/caddy.service.d/hng.conf || return 1
    sudo systemctl daemon-reload || return 1
    caddy_changed=1
  fi
  if ! sudo cmp -s "$app/server/deploy/Caddyfile" /etc/caddy/Caddyfile; then
    say "Caddyfile changed: installing it"
    sudo install -m 644 -o root -g root "$app/server/deploy/Caddyfile" /etc/caddy/Caddyfile || return 1
    caddy_changed=1
  fi
  if [ "$caddy_changed" = 1 ]; then
    say "Reloading Caddy"
    # A reload goes through the admin socket. The first time the Caddyfile moves the admin API
    # there, the running Caddy still listens on localhost:2019, so the reload fails: restart instead.
    if ! sudo systemctl reload caddy; then
      say "Reload failed (first move of the admin API to its socket?): restarting Caddy"
      sudo systemctl restart caddy || return 1
    fi
  fi

  if [ "$force" = 1 ]; then
    say "--force: not waiting for the rooms to empty"
  else
    say "Waiting for rooms: 0 (up to 10 minutes; Ctrl-C to cancel, nothing is restarted until then)"
    waited=0
    while :; do
      if json=$(health); then
        rooms=$(printf '%s' "$json" | field rooms)
        [ "$rooms" = 0 ] && break
        printf '    rooms: %s, members: %s\n' "$rooms" "$(printf '%s' "$json" | field members)"
      else
        say "The relay does not answer /healthz, so nothing to wait for"
        break
      fi
      if [ "$waited" -ge 600 ]; then
        say "Rooms did not empty in 10 minutes. Not restarting. The new code is on disk; run again later or with --force."
        return 3
      fi
      sleep 10
      waited=$((waited + 10))
    done
  fi

  say "Restarting hng-relay"
  sudo systemctl restart hng-relay || return 1

  say "Checking /healthz"
  for _ in $(seq 1 30); do
    if json=$(health); then
      printf '    ok: %s\n    version: %s\n    uptime: %s s\n    rooms: %s\n' \
        "$(printf '%s' "$json" | field ok)" "$(printf '%s' "$json" | field version)" \
        "$(printf '%s' "$json" | field uptimeS)" "$(printf '%s' "$json" | field rooms)"
      say "Deployed $before -> $after"
      return 0
    fi
    sleep 1
  done
  say "The relay did not answer /healthz after the restart. Last log lines:"
  sudo journalctl -u hng-relay -n 30 --no-pager
  return 1
}
main "$@" < /dev/null
exit $?
REMOTE
