# HTTPS Setup

The Recalbox Dashboard PWA and Web Push notifications require **HTTPS** (except on `localhost`).

On iOS, Web Push also requires the app to be **installed as a PWA** first (Add to Home Screen via Safari).

Below are four options to enable HTTPS on your local network.

---

## Option 1 — Caddy + mkcert (Recommended for local dev)

[Caddy](https://caddyserver.com/) auto-manages TLS. [mkcert](https://github.com/FiloSottile/mkcert) creates a locally-trusted certificate.

```bash
# Install mkcert
brew install mkcert        # macOS
sudo apt install mkcert    # Ubuntu

# Trust the local CA
mkcert -install

# Generate a cert for your machine hostname
mkcert recalbox-dashboard.local "*.recalbox-dashboard.local" localhost 127.0.0.1

# Caddyfile
recalbox-dashboard.local {
  tls /path/to/cert.pem /path/to/key.pem
  reverse_proxy localhost:3000
}
```

Add `recalbox-dashboard.local` to `/etc/hosts` pointing to `127.0.0.1`.

---

## Option 2 — Tailscale (Easiest for remote access)

[Tailscale](https://tailscale.com/) provides HTTPS certificates for every device on your tailnet.

```bash
# Enable HTTPS on your machine
tailscale serve https / http://localhost:3000

# Access via your Tailscale domain (e.g. my-machine.tail12345.ts.net)
```

Certificates are managed automatically. No configuration needed.

---

## Option 3 — Nginx Proxy Manager + Let's Encrypt

If you have a domain pointing to your server:

1. Deploy [Nginx Proxy Manager](https://nginxproxymanager.com/) via Docker
2. Add a proxy host for `yourdomain.com` → `http://localhost:3000`
3. Enable SSL with Let's Encrypt (free certificate, auto-renewed)

---

## Option 4 — Cloudflare Tunnel

For access from outside your network without port forwarding:

```bash
# Install cloudflared
brew install cloudflared    # macOS

# Authenticate and create a tunnel
cloudflared tunnel login
cloudflared tunnel create recalbox-dashboard

# Route traffic
cloudflared tunnel route dns recalbox-dashboard dashboard.yourdomain.com

# Run the tunnel
cloudflared tunnel run --url http://localhost:3000 recalbox-dashboard
```

Free tier supports unlimited tunnels.

---

## iOS Web Push Requirements

For Web Push to work on iPhone/iPad:

1. **HTTPS** — required (any option above)
2. **Installed as PWA** — open Safari → tap Share → Add to Home Screen
3. **Permission granted** — tap "Allow" when prompted after install
4. **iOS 16.4+** — earlier versions do not support Web Push

Once installed, notifications work even when the app is in the background.
