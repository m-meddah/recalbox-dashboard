# Deployment

## Docker Compose (generic)

The quickest path on any Linux machine with Docker:

```bash
curl -O https://raw.githubusercontent.com/m-meddah/recalbox-dashboard/main/docker-compose.yml
nano docker-compose.yml   # set RECALBOX_HOST
docker compose up -d
```

## Synology NAS

### Container Manager (DSM 7.2+)

1. Open **Container Manager → Project → Create**
2. Paste the contents of `docker-compose.yml`
3. Set `RECALBOX_HOST` to your Recalbox IP (e.g. `192.168.1.10`)
4. Click **Build** and wait for the image to pull
5. Open `http://<NAS-IP>:3000`

### Via SSH

```bash
ssh admin@<NAS-IP>
mkdir -p /volume1/docker/recalbox-dashboard
cd /volume1/docker/recalbox-dashboard
curl -O https://raw.githubusercontent.com/m-meddah/recalbox-dashboard/main/docker-compose.yml
# Edit the file, then:
docker compose up -d
```

## Unraid

1. Go to **Apps → Community Applications** and search for a Docker template, or use the manual method:
2. **Docker → Add Container**
   - Repository: `ghcr.io/m-meddah/recalbox-dashboard:latest`
   - Port mapping: `3000 → 3000`
   - Path mapping: `/mnt/user/appdata/recalbox-dashboard → /data`
   - Environment variables: `RECALBOX_HOST`, `RECALBOX_SSH_USER`, `RECALBOX_SSH_PASSWORD`

## Behind a Traefik reverse proxy

Add these labels to the service in `docker-compose.yml`:

```yaml
services:
  recalbox-dashboard:
    image: ghcr.io/m-meddah/recalbox-dashboard:latest
    restart: unless-stopped
    volumes:
      - recalbox-data:/data
    environment:
      RECALBOX_HOST: recalbox.local
      RECALBOX_SSH_USER: root
      RECALBOX_SSH_PASSWORD: recalboxroot
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.recalbox.rule=Host(`recalbox.example.com`)"
      - "traefik.http.routers.recalbox.entrypoints=websecure"
      - "traefik.http.routers.recalbox.tls.certresolver=letsencrypt"
      - "traefik.http.services.recalbox.loadbalancer.server.port=3000"
    networks:
      - traefik

networks:
  traefik:
    external: true

volumes:
  recalbox-data:
```

## Raspberry Pi (ARM64)

The image is built for `linux/arm64`. It runs natively on Pi 4/5 with a 64-bit OS:

```bash
# On the Pi (requires Docker installed)
curl -O https://raw.githubusercontent.com/m-meddah/recalbox-dashboard/main/docker-compose.yml
nano docker-compose.yml
docker compose up -d
```

## Updating

```bash
docker compose pull
docker compose up -d
```

## Backup and restore

```bash
# Backup SQLite database
docker run --rm \
  -v recalbox-data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/recalbox-backup-$(date +%Y%m%d).tar.gz /data

# Restore
docker run --rm \
  -v recalbox-data:/data \
  -v $(pwd):/backup \
  alpine tar xzf /backup/recalbox-backup-20240101.tar.gz -C /
```

## Connecting machines across homes (mesh VPN)

If your Recalbox machines are in different homes (behind separate NATs), see
[mesh-vpn-setup.md](mesh-vpn-setup.md) for the Tailscale subnet-router setup.
