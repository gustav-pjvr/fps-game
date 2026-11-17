# Relay deployment kit

Everything needed to run the multiplayer relay (`server/`) on one Ubuntu 24.04 VM (Oracle Cloud
Always Free Ampere, Johannesburg) behind Caddy and Let's Encrypt, under a DuckDNS name. The design is
in `docs/server-relay-design.md`, section 8. Nothing site-specific is stored in this repository: the
DuckDNS name, the access codes and the token are typed in during setup and live only on the VM.

| File | What it is |
|---|---|
| `setup.sh` | Run once as root on a fresh VM (safe to repeat). Installs and starts everything. |
| `hng-relay.service` | The systemd unit for the relay (user `hng`, hardened). |
| `Caddyfile` | TLS front: `{$HNG_DOMAIN}` reverse proxied to `127.0.0.1:8080`. |
| `duckdns-update.sh` | Installed as `/usr/local/sbin/hng-duckdns-update`; a root cron runs it every 5 minutes. |
| `deploy.sh` | Update the VM from your machine. |
| `status.sh` | Look at the VM from your machine. |

Where things live on the VM:

| Path | Content | Access |
|---|---|---|
| `/opt/hng-relay` | sparse checkout of the public repo (`server/`, `src/network/` and three small files) | root owns, `hng` reads |
| `/etc/hng-relay.env` | `HNG_ACCESS_CODES` and the other `HNG_` settings | root, mode 600 |
| `/etc/hng-duckdns.token` | the DuckDNS token | root, mode 600 |
| `/etc/hng-caddy.env` | `HNG_DOMAIN=<name>.duckdns.org` (not a secret) | root, 644 |
| `/var/log/hng-duckdns.log` | one line per DuckDNS update, no token | root, mode 600 |

## First install

1. **Create the VM.** Oracle Cloud, home region Johannesburg. Shape `VM.Standard.A1.Flex` (2 OCPU, 12 GB),
   image Canonical Ubuntu 24.04 (aarch64), a reserved public IPv4 address, SSH key only. Keep the private
   key on your machine as `~/.ssh/hng_relay_ed25519` (the scripts look there by default; set
   `HNG_SSH_KEY` to use another path).
2. **Open the cloud firewall.** In the VM's subnet security list (or a network security group) allow
   ingress TCP 80 and TCP 443 from `0.0.0.0/0`, and TCP 22 from your own address only. `setup.sh` opens
   the same ports inside the VM, but it cannot change Oracle's own rules.
3. **Point DuckDNS at the VM.** Sign in at duckdns.org, create a subdomain, put the VM's public IP in
   the "current ip" box and press update. Note the token shown at the top of the page. (The updater on
   the VM keeps the address right afterwards.)
4. **Copy `setup.sh` over** and run it, with a terminal so the prompts can hide what you type:

   ```
   scp -i ~/.ssh/hng_relay_ed25519 server/deploy/setup.sh ubuntu@<vm-ip>:
   ssh -t -i ~/.ssh/hng_relay_ed25519 ubuntu@<vm-ip> sudo ./setup.sh --subdomain <name>
   ```

   Options: `--origins LIST` (default: the Pages site and its previews), `--branch BRANCH` (default
   `master`; the branch must contain `server/deploy/`), `--reconfigure`. It asks for the access codes
   (comma separated, typed twice) and the DuckDNS token with the echo off. At the end it waits for
   `https://<name>.duckdns.org/healthz` and prints the answer. A first certificate can take a minute.
5. **Test from a browser.** Open `https://<name>.duckdns.org/healthz`: you should see
   `{"ok":true,"version":"...","uptimeS":...,"rooms":0,"members":0}`. Then open the game, enter an access
   code in the Multiplayer menu and create a room. Run `server/deploy/status.sh ubuntu@<vm-ip>` for the log.

## Updating

```
server/deploy/deploy.sh ubuntu@<vm-ip>
```

It pulls the branch the VM runs, runs `npm ci --omit=dev`, waits (up to 10 minutes) until `/healthz`
shows `rooms: 0`, restarts the service and prints the version and uptime. If rooms never empty it stops
before restarting and says so. `--force` skips the wait and drops anyone in a match. If the unit or the
Caddyfile changed in the repo, `deploy.sh` installs them too.

Operating system security updates install on their own, and the VM reboots at 04:00 SAST (02:00 UTC)
when one needs it. Caddy and Node come from their own apt repositories: `sudo apt-get update && sudo
apt-get upgrade` now and then keeps them current (a Node upgrade needs `sudo systemctl restart
hng-relay` afterwards).

## Rotating the access code

The list is comma separated, so add the new code first, tell your friends, then drop the old one.

```
ssh -t -i ~/.ssh/hng_relay_ed25519 ubuntu@<vm-ip> sudo ./setup.sh --reconfigure
```

Enter the full new list (old and new, or only the new one) when asked, press Enter at the token prompt
to keep the current one. The script rewrites `/etc/hng-relay.env` and restarts the relay, which ends
current rooms, so do it when nobody is playing. It needs `setup.sh` on the VM; copy it over again if
you removed it. Without the script you can edit the file by hand with `sudo nano /etc/hng-relay.env`
(the codes are visible on screen) and run `sudo systemctl restart hng-relay`.

## Rebuilding a lost VM

Oracle can reclaim an Always Free VM it judges idle (design section 8.4). Rebuilding takes about half an
hour and needs only what is in this folder plus the two secrets:

1. Create a new VM as in steps 1 and 2 above (a new IP is fine).
2. Put the new IP into DuckDNS (step 3). The name stays the same, so the game needs no change.
3. Copy and run `setup.sh` (step 4) with the same subdomain, access codes and token.
4. Test (step 5). Remove the old host key with `ssh-keygen -R <old-ip>` if the IP was reused.

## Checking the firewall

Two layers must both allow TCP 80 and 443: Oracle's security list (in the console) and iptables on the VM.

```
sudo iptables -L INPUT -n --line-numbers
```

The ACCEPT rules for `dpt:80` and `dpt:443` must appear before the final `REJECT` line. To confirm they
survive a reboot: `sudo grep -E 'dport (80|443)' /etc/iptables/rules.v4`. If they are missing, run
`setup.sh` again (it re-adds and saves them). From outside, `curl -I https://<name>.duckdns.org/healthz`
shows whether the port answers; "connection timed out" usually means a closed firewall layer, while
"connection refused" or a TLS error points at Caddy (`sudo journalctl -u caddy -n 50 --no-pager`).
