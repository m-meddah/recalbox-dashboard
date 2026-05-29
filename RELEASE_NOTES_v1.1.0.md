# v1.1.0 — Recommendations & Taste Profile

The dashboard now knows what you like and can suggest what to play tonight.

## What's new

- **What to Play Tonight** — pick a mood (chill, challenge, nostalgia, discovery, finish, surprise)
  and how long you have (30 min → 4 h). The engine scores your entire collection against your
  play history, ratings, and the current context, and hands you the best picks for right now.
  Each card explains why the game was chosen and shows a confidence level.

- **Taste Profile** — the dashboard infers your preferences from session history: which systems,
  genres, decades, and developers you gravitate toward, with weights that decay so that recent
  play counts more than old play. A maturity indicator shows how much signal has been collected;
  recommendations get sharper as it grows.

- **Session feedback** — after each real session (anything over 2 minutes), a prompt asks you to
  rate the game: love, like, or dislike. Ratings feed directly into the recommendation score and
  the profile weights, so the more you rate, the better the suggestions.

- **IGDB enrichment** — connect your Twitch credentials in Settings → IGDB to link your
  collection to IGDB entries. The engine uses IGDB critic ratings and a similarity graph to boost
  games close to your comfort games. Matching runs silently in the background; a review UI flags
  low-confidence matches for manual confirmation.

- **Now Playing: browsing and screensaver** — the Now Playing card now reflects when
  EmulationStation is in game-browsing mode or when the screensaver is active, not only when a
  game is actually running.

## Improvements & fixes

- SSH circuit breaker — requests to an unreachable Recalbox now fail fast instead of hanging
- PWA reliability improvements and missing iOS Safari meta tag
- Wrapped: minutes displayed correctly for short playtime totals; archive page restored navbar and theme
- Stats: NULL-safe comparison for `recalbox_id` in total playtime query
- API hardening: error logging and input validation on several routes
- `pnpm dev:all` and `pnpm dev:all:mobile` scripts to start Next.js and scrobbler together

## Upgrade

```bash
docker compose pull && docker compose up -d
```

A database migration runs automatically on startup. No manual steps required.

## Documentation

- [Recommendation algorithm](https://github.com/m-meddah/recalbox-dashboard/blob/main/docs/recommendations.md)
- [Full changelog](https://github.com/m-meddah/recalbox-dashboard/blob/main/CHANGELOG.md)
