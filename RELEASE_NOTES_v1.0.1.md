# v1.0.1 — Maintenance release

Bugfix and polish release on top of v1.0.0.

## What's fixed

- **Favicon and PWA icons** — icons are now served reliably on all platforms (iOS, Android, desktop) using the Next.js file convention
- **Android layout** — corrected a horizontal overflow that broke the responsive layout on Android browsers
- **Wrapped recap** — fixed a Satori rendering error that prevented shareable images from generating correctly
- **Mobile navigation** — added a hamburger drawer so the app is fully navigable on small screens
- **Welcome setup** — the setup form now works without JavaScript, improving reliability on constrained devices

## Upgrade

```
docker compose pull && docker compose up -d
```

No migration required.

## Full changelog

See [CHANGELOG.md](CHANGELOG.md) for the complete list of changes.
