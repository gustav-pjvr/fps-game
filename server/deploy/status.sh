#!/usr/bin/env bash
# Show how the relay VM is doing, over SSH (Git Bash on Windows works).
#
#   server/deploy/status.sh <ssh-target>
#
#   <ssh-target>  user@host of the VM, for example ubuntu@<vm-ip>
#
# Environment (optional): HNG_SSH_KEY is the private key to use (default ~/.ssh/hng_relay_ed25519).
#
# Prints the service state, /healthz, the last 50 log lines (the relay redacts secrets in its own
# log), and disk and memory. It never prints the env file.
set -euo pipefail

usage() { sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; }

case ${1:-} in
  '' | -*) usage >&2; exit 2 ;;
esac
[ $# -eq 1 ] || { usage >&2; exit 2; }
target=$1

key=${HNG_SSH_KEY:-$HOME/.ssh/hng_relay_ed25519}
[ -f "$key" ] || { printf 'status.sh: SSH key not found: %s (set HNG_SSH_KEY to use another)\n' "$key" >&2; exit 1; }

ssh_opts=(-i "$key" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30)

ssh "${ssh_opts[@]}" "$target" 'bash -s' << 'REMOTE'
main() {
  printf '==> Services\n'
  for unit in hng-relay caddy; do
    printf '%s: %s (since %s)\n' "$unit" "$(systemctl is-active "$unit" || true)" \
      "$(systemctl show "$unit" --property=ActiveEnterTimestamp --value)"
  done
  printf '\n==> Relay /healthz\n'
  # Straight to the relay, not through Caddy: only a local request sees version, uptime and counts.
  curl -sS --max-time 5 http://127.0.0.1:8080/healthz || printf 'no answer\n'
  printf '\n\n==> Last 50 log lines (hng-relay)\n'
  sudo journalctl -u hng-relay -n 50 --no-pager || true
  printf '\n==> Disk\n'
  df -h /
  printf '\n==> Memory\n'
  free -h
  printf '\n==> Uptime\n'
  uptime
}
main "$@" < /dev/null
exit 0
REMOTE
