# Pocket Arena VPS Production Deployment

This guide deploys Pocket Arena to a self-managed Ubuntu VPS:

```text
custom domain -> Caddy HTTPS reverse proxy -> Node/Express/Socket.IO on 127.0.0.1:3000
```

Node does not terminate TLS in production. Caddy owns public HTTP/HTTPS and proxies to the local Node port.

## 1. Create The VPS

Create an Ubuntu 24.04 LTS or 22.04 LTS VPS with at least:

- 1 vCPU
- 1 GB RAM minimum, 2 GB preferred
- 10 GB disk or more
- A stable public IPv4 address
- IPv6 enabled if your provider supports it

Create a regular SSH user with sudo access. Disable password SSH login after key login works.

## 2. DNS

Point the production domain to the VPS:

```text
A     pocketarena.app    <server IPv4>
AAAA  pocketarena.app    <server IPv6>
```

Use only the records your VPS actually supports. Wait for DNS to propagate before enabling Caddy.

## 3. Install Node

Install Node.js 22 LTS with NodeSource:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git build-essential
node --version
npm --version
```

## 4. Install Caddy

```bash
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update
sudo apt-get install -y caddy
```

## 5. Create The Application User

```bash
sudo useradd --system --create-home --home-dir /opt/pocket-arena --shell /bin/bash pocketarena
sudo mkdir -p /opt/pocket-arena/repo /opt/pocket-arena/releases
sudo chown -R pocketarena:pocketarena /opt/pocket-arena
sudo usermod -aG pocketarena "$USER"
```

The application runs as `pocketarena`, not root.

The human or CI deploy user needs write access to `/opt/pocket-arena` and limited sudo rights to restart the service. Create a sudoers file with `visudo`:

```bash
sudo visudo -f /etc/sudoers.d/pocket-arena-deploy
```

Example:

```text
your-deploy-user ALL=(root) NOPASSWD: /bin/systemctl restart pocket-arena
```

Log out and back in after adding yourself to the `pocketarena` group.

## 6. Clone The Repository

```bash
sudo -u pocketarena git clone <your-repository-url> /opt/pocket-arena/repo
cd /opt/pocket-arena/repo
sudo -u pocketarena git checkout main
```

## 7. Configure Environment Variables

Create a protected environment file:

```bash
sudo mkdir -p /etc/pocket-arena
sudo cp /opt/pocket-arena/repo/deploy/pocket-arena.env.example /etc/pocket-arena/pocket-arena.env
sudo nano /etc/pocket-arena/pocket-arena.env
sudo chown root:pocketarena /etc/pocket-arena/pocket-arena.env
sudo chmod 640 /etc/pocket-arena/pocket-arena.env
```

Recommended production values:

```bash
PORT=3000
HOST=127.0.0.1
PUBLIC_BASE_URL=https://pocketarena.app
```

`PUBLIC_BASE_URL` is optional but recommended. If it is absent, QR links use the HTTPS origin supplied by the browser/proxy. Do not put private keys, SSH keys, passwords, or tokens in the repository.

## 8. Install The systemd Service

```bash
sudo cp /opt/pocket-arena/repo/deploy/pocket-arena.service /etc/systemd/system/pocket-arena.service
sudo systemctl daemon-reload
sudo systemctl enable pocket-arena
```

The service starts after networking, restarts after failure, and starts again after reboot. It exposes only `127.0.0.1:3000` when `HOST=127.0.0.1`.

## 9. Configure Caddy

Copy the template and replace the domain if needed:

```bash
sudo cp /opt/pocket-arena/repo/deploy/Caddyfile /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
sudo systemctl enable caddy
```

Template:

```caddyfile
pocketarena.app {
    reverse_proxy 127.0.0.1:3000
}
```

Caddy automatically obtains and renews HTTPS certificates.

## 10. Firewall

Allow only SSH, HTTP, and HTTPS from the public internet:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status verbose
```

Do not open port `3000` publicly. Node should only be reachable locally by Caddy.

## 11. First Deployment

Run the safe deployment script as a sudo-capable deploy user:

```bash
sudo chmod +x /opt/pocket-arena/repo/scripts/deploy-vps.sh
/opt/pocket-arena/repo/scripts/deploy-vps.sh main
```

The script:

- fetches and fast-forwards the selected branch
- creates a new release directory
- runs `npm ci`
- runs `npm run typecheck`
- runs `npm test`
- runs `npm run build`
- switches `/opt/pocket-arena/current` only after verification passes
- restarts `pocket-arena`
- checks `/health`
- rolls back the symlink if restart or health check fails

## 12. Automatic Deployment

The optional workflow is `.github/workflows/deploy-vps.yml`. Configure repository secrets:

```text
VPS_HOST       server hostname or IP
VPS_USER       SSH user allowed to run the deploy script
VPS_SSH_KEY    private deploy key
VPS_SSH_PORT   optional, defaults to 22
```

Store secrets only in GitHub repository secrets. Never commit private keys, passwords, API tokens, or environment files.

The workflow verifies the app in GitHub Actions, then SSHes to the VPS and runs the same safe deploy script.

## 13. Verification

After deployment:

```bash
curl -fsS https://pocketarena.app/health
curl -I https://pocketarena.app/host/racing
curl -I https://pocketarena.app/host/controller-test
curl -I https://pocketarena.app/join/ABC123
sudo systemctl status pocket-arena
sudo journalctl -u pocket-arena -n 100 --no-pager
```

In the browser:

- Open `https://pocketarena.app`
- Start Racing
- Confirm the QR URL starts with `https://pocketarena.app`
- Scan with a phone
- Confirm the phone controller route opens
- Confirm Socket.IO connects without a separate host URL
- Confirm phone motion controls work over HTTPS

## 14. Rollback

List releases:

```bash
ls -1 /opt/pocket-arena/releases
```

Roll back manually:

```bash
sudo ln -sfn /opt/pocket-arena/releases/<release-name> /opt/pocket-arena/current
sudo systemctl restart pocket-arena
curl -fsS http://127.0.0.1:3000/health
```

The deploy script also rolls back automatically if the new release fails to restart or pass health checks.

## 15. Logs

Application logs:

```bash
sudo journalctl -u pocket-arena -f
```

Caddy logs:

```bash
sudo journalctl -u caddy -f
```

Service state:

```bash
sudo systemctl status pocket-arena
sudo systemctl status caddy
```

## 16. Backups

Back up:

- `/etc/pocket-arena/pocket-arena.env`
- `/etc/systemd/system/pocket-arena.service`
- `/etc/caddy/Caddyfile`
- `/opt/pocket-arena/repo`
- any future persistent game data directory

The current app keeps rooms in memory on one server instance, so there is no production database to back up yet.

## 17. Security Updates

Keep the server patched:

```bash
sudo apt-get update
sudo apt-get upgrade -y
sudo reboot
```

Recommended hardening:

- SSH keys only
- Disable root SSH login
- Keep UFW enabled
- Keep Node bound to `127.0.0.1`
- Keep Caddy as the only public web entry point
- Rotate deploy keys when team access changes
