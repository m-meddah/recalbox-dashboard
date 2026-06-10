# Multi-user (SaaS) deployment — Tailscale Funnel

This guide deploys the **multi-user** dashboard on an always-on host, exposed over
public HTTPS via [Tailscale Funnel](https://tailscale.com/kb/1223/funnel). Family
members reach it from anywhere without installing Tailscale on their own device.

The dashboard reaches each Recalbox over the mesh VPN — see
[mesh-vpn-setup.md](mesh-vpn-setup.md) for connecting machines in different homes.
Funnel here exposes only the dashboard itself.

> Single-user LAN self-hosting? Use [deployment.md](deployment.md) instead — it does
> not require auth secrets or Funnel.

## 1. Prerequisites

- An always-on Linux host with Docker + Docker Compose.
- [Tailscale installed on the host](https://tailscale.com/download) and the node
  joined to your tailnet (`tailscale up`).
- Funnel enabled for your tailnet (Tailscale admin console → **Settings → Funnel**,
  and the `funnel` attribute granted in your ACLs).

## 2. Generate secrets (one-shot)

```bash
openssl rand -base64 32   # BETTER_AUTH_SECRET
openssl rand -base64 32   # CREDENTIALS_SECRET (optional — see below)
```

Create a `.env` next to the compose file, readable only by you:

```bash
umask 077
cat > .env <<'EOF'
BETTER_AUTH_SECRET=<paste first value>
# BETTER_AUTH_URL / BETTER_AUTH_TRUSTED_ORIGINS are filled in at step 5.
BETTER_AUTH_URL=
BETTER_AUTH_TRUSTED_ORIGINS=
# Optional: rotate the credential-encryption key independently of the auth secret.
CREDENTIALS_SECRET=
TZ=Europe/Paris
EOF
```

> ⚠️ **Never regenerate these secrets once data exists.** Rotating
> `BETTER_AUTH_SECRET` invalidates every session **and** — because it also derives the
> credential-encryption key by default (Phase 4) — makes stored SSH/IGDB secrets
> permanently undecryptable. Set `CREDENTIALS_SECRET` if you need to rotate the auth
> secret without touching the credential key. Store both somewhere safe (a password
> manager); a database backup is useless without them.

## 3. Start the container

```bash
docker compose -f docker-compose.saas.yml up -d
docker compose -f docker-compose.saas.yml logs -f   # watch startup + migrations
```

The container binds `127.0.0.1:3000` only. Confirm it is healthy locally:

```bash
curl -fsS http://localhost:3000/api/health && echo OK
```

## 4. Expose via Tailscale Funnel

```bash
tailscale funnel --bg 3000
tailscale funnel status   # prints the public https://<node>.<tailnet>.ts.net URL
```

## 5. Point Better Auth at the public URL

Edit `.env` and set both to the Funnel URL from step 4:

```
BETTER_AUTH_URL=https://<node>.<tailnet>.ts.net
BETTER_AUTH_TRUSTED_ORIGINS=https://<node>.<tailnet>.ts.net
```

Apply the change:

```bash
docker compose -f docker-compose.saas.yml up -d
```

Setting `BETTER_AUTH_URL` to an `https://` origin also makes Better Auth issue secure
cookies automatically. If you also reach the app over a MagicDNS name, add it to
`BETTER_AUTH_TRUSTED_ORIGINS` as a second comma-separated origin.

### Verify the login rate limit is active

The brute-force throttle on `/sign-in/email` is enabled only when `NODE_ENV=production`
(the shipped image sets this) and relies on Better Auth seeing the client IP via an
`X-Forwarded-For` header. Tailscale Funnel forwards `X-Forwarded-For`, but if your
proxy chain strips or renames it, Better Auth cannot identify the caller and **silently
skips rate limiting** (it logs a single warning at startup).

After deploying, confirm the throttle works: from a browser, submit 6+ failed logins
within a minute — the 6th should be rejected with HTTP 429. If it is not, check the
container logs for a "rate limit" / IP warning, and if your proxy uses a different
header, set it via Better Auth's `advanced.ipAddress.ipAddressHeaders` in
`apps/dashboard/lib/auth/server.ts` (e.g. `['x-real-ip']`).

## 6. Bootstrap the admin account

Sign-up is disabled (invitation-only). Create the first admin with the bundled CLI:

```bash
docker compose -f docker-compose.saas.yml exec recalbox-dashboard \
  node /app/create-user.js you@example.com 'a-strong-password' admin
```

Then open the public URL, log in, and add your Recalbox machines through the UI
(**Settings → Recalbox**). Each machine is owned by the account that creates it.

Additional family accounts use the same command with the `member` role (until email
invitations land in a later phase):

```bash
docker compose -f docker-compose.saas.yml exec recalbox-dashboard \
  node /app/create-user.js relative@example.com 'their-password' member
```

## 7. Backup & restore

The SQLite database (with **encrypted** credentials) lives in the `recalbox-data`
volume. Back it up — and keep `BETTER_AUTH_SECRET`/`CREDENTIALS_SECRET` with it, or the
backup cannot be decrypted:

```bash
# Backup
docker run --rm \
  -v recalbox-data:/data \
  -v "$(pwd)":/backup \
  alpine tar czf /backup/recalbox-backup-$(date +%Y%m%d).tar.gz /data

# Restore
docker run --rm \
  -v recalbox-data:/data \
  -v "$(pwd)":/backup \
  alpine tar xzf /backup/recalbox-backup-YYYYMMDD.tar.gz -C /
```

## Updating

```bash
docker compose -f docker-compose.saas.yml pull
docker compose -f docker-compose.saas.yml up -d
```

---

## Annex B — Tailscale in a sidecar container

If you prefer not to install Tailscale on the host OS, run it as a second container
with its own state volume and an
[auth key](https://tailscale.com/kb/1085/auth-keys), share its network namespace with
the dashboard container (`network_mode: service:tailscale`), and run `tailscale funnel`
from inside it. This keeps the app entirely off the host network at the cost of an
extra container and an auth key to manage. See the
[Tailscale Docker guide](https://tailscale.com/kb/1282/docker).

## Annex C — Reverse proxy + custom domain

To serve from your own domain instead of `*.ts.net`, put Caddy/Traefik/Nginx in front
(see [deployment.md](deployment.md) for a Traefik label example and
[https-setup.md](https-setup.md) for Caddy / Nginx Proxy Manager / Cloudflare Tunnel).
Set `BETTER_AUTH_URL` and `BETTER_AUTH_TRUSTED_ORIGINS` to your custom `https://` origin.
