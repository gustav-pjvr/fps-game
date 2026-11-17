#!/usr/bin/env bash
# Update the relay on the VM from your own machine (Git Bash on Windows works).
#
#   server/deploy/deploy.sh <ssh-target> [--force]
#
#   <ssh-target>  user@host of the VM, for example ubuntu@<vm-ip> (a name from ~/.ssh/config works too)
#   --force       do not wait for the rooms to empty: players in a match are disconnected
#
# Environment (optional): HNG_SSH_KEY is the private key to use (default ~/.ssh/hng_relay_ed25519).
#
# On the VM it pulls the branch already checked out in /opt/hng-relay, runs npm ci --omit=dev, waits
# until /healthz reports rooms: 0 (up to 10 minutes), restarts the service and checks /healthz.
# It never prints the env file.
set -euo pipefail

usage() { sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; }

target=''
force=0
for arg in "$@"; do
  case $arg in
    --force) force=1 ;;
    -h | --help) usage; exit 0 ;;
    -*) printf 'deploy.sh: unknown option %s\n' "$arg" >&2; exit 2 ;;
    *)
      [ -z "$target" ] || { printf 'deploy.sh: more than one target given\n' >&2; exit 2; }
      target=$arg
      ;;
  esac
done
[ -n "$target" ] || { usage >&2; exit 2; }

key=${HNG_SSH_KEY:-$HOME/.ssh/hng_relay_ed25519}
[ -f "$key" ] || { printf 'deploy.sh: SSH key not found: %s (set HNG_SSH_KEY to use another)\n' "$key" >&2; exit 1; }

ssh_opts=(-i "$key" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30 -o ServerAliveCountMax=6)

# The whole remote script is one function that is called on the last line, so bash has read all of
# it before any command can touch stdin. Every command inside also reads from /dev/null.
ssh "${ssh_opts[@]}" "$target" "bash -s -- $force" << 'REMOTE'
main() {
  force=$1
  app=/opt/hng-relay
  say() { printf '==> %s\n' "$*"; }

  health() { curl -fsS --max-time 5 http://127.0.0.1:8080/healthz; }
  # field NAME < json: prints one field of the /healthz JSON.
  field() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s)[process.argv[1]])}catch{console.log("?")}})' "$1"; }

  branch=$(sudo git -C "$app" rev-parse --abbrev-ref HEAD)
  before=$(sudo git -C "$app" rev-parse --short HEAD)

  say "Pulling branch $branch (now at $before)"
  sudo git -C "$app" fetch --depth 1 origin "$branch" || return 1
  sudo git -C "$app" reset --hard FETCH_HEAD || return 1
  after=$(sudo git -C "$app" rev-parse --short HEAD)
  say "At $after"

  say "Installing dependencies"
  (cd "$app/server" && sudo npm ci --omit=dev --no-audit --no-fund) || return 1

  if ! sudo cmp -s "$app/server/deploy/hng-relay.service" /etc/systemd/system/hng-relay.service; then
    say "Service unit changed: installing it"
    sudo install -m 644 -o root -g root "$app/server/deploy/hng-relay.service" /etc/systemd/system/hng-relay.service || return 1
    sudo systemctl daemon-reload || return 1
  fi
  if ! sudo cmp -s "$app/server/deploy/Caddyfile" /etc/caddy/Caddyfile; then
    say "Caddyfile changed: installing it and reloading Caddy"
    sudo install -m 644 -o root -g root "$app/server/deploy/Caddyfile" /etc/caddy/Caddyfile || return 1
    sudo systemctl reload caddy || return 1
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
