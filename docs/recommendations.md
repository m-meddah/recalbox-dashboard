# Recommendations

The recommendation engine powers the **What to Play Tonight** page (`/play-tonight`) and the **Taste Profile** page (`/profile`). This document describes how both work.

---

## What to Play Tonight

### Overview

When you open `/play-tonight`, you pick a **mood** and **available time**. The engine scores every non-hidden game in your collection and returns the top picks for that context.

### Mood

| Mood | Description |
| ---- | ----------- |
| `chill` | Favours short, casual games (platformers, puzzle, handheld systems). Penalises long RPGs. Boosts comfort games. |
| `challenge` | Favours action genres (shmup, fighting, beat'em up) and arcade systems. |
| `nostalgia` | Boosts games you haven't touched in more than 6 months and your comfort games. |
| `discovery` | Boosts never-played games with a good rating. Penalises comfort games (you already know those). |
| `finish` | Restricts candidates to games with at least 1 meaningful session in the last 6 months — i.e. games you started but didn't finish. |
| `surprise` | Like the others but with a higher random jitter to surface unexpected picks. |

### Available Time

| Selection | Best for |
| --------- | -------- |
| 30 min | Arcade and handheld games. RPGs and strategy games are penalised. |
| 1 h | Light bias toward shorter games. |
| 2 h | Neutral. |
| 4 h | Boosts RPGs and strategy games. Arcade is slightly penalised. |

### Scoring Factors

Each game receives a numeric score built from these components:

| Factor | Max contribution | Notes |
| ------ | ---------------- | ----- |
| System match | 30 | Based on system weight in your taste profile |
| Genre match | 25 | Best-matching genre weight |
| IGDB similarity boost | 50 | Game is similar to one of your top comfort games |
| User rating — love | 35 | You've rated this game "love" |
| User rating — like | 15 | You've rated this game "like" |
| Confirmed taste | 15 | ≥ 3 meaningful sessions or ≥ 1 marathon session |
| Comfort game (chill / nostalgia mood) | 20 | Game is in your top 10 comfort games |
| Decade match | 10 | Based on decade weight in your taste profile |
| Developer match | 8 | Based on developer weight in your taste profile |
| Scraped rating boost | up to 9 | When scraper rating > 0.7 |
| IGDB critic rating boost | variable | When IGDB rating > 75 |
| Time match | ±25 | Genre / system vs. selected time slot |
| Novelty (discovery mood) | 35 | Never-played game |
| Staleness bonus | 12–30 | Not played in > 6 months (mood-dependent) |
| Too recent penalty | −12 | Played in the last month |
| Mood genre / system bias | ±20 | Genre or system aligned / misaligned with mood |
| Random jitter | ±4 (±10 in surprise) | Prevents deterministic results |

**Hard exclusions** — games are removed from the candidate list entirely if:
- The user explicitly marked them "dislike"
- They are in the skip list (skipped from Play Tonight in the last 24 h)
- They appear in the "bouncer games" list and are not rated "love" (the user tried them multiple times and always left quickly)

### Confidence Level

Each recommendation card shows a confidence level:

| Level | Meaning |
| ----- | ------- |
| `high` | Rated "love", IGDB-similar to a comfort game, or confirmed taste (≥ 3 meaningful sessions) |
| `medium` | Rated "like", or strong system + genre match |
| `exploration` | The engine doesn't have enough data yet — take a chance |

### IGDB Enrichment

When IGDB credentials are configured (Settings → IGDB), the engine enriches the top-scoring candidates with IGDB metadata after each recommendation run:

1. The engine scores all games and selects finalists.
2. It triggers async matching for up to 5 unmatched games from the top 30 (fire-and-forget — no delay for the user).
3. On subsequent runs, matched games receive IGDB critic ratings and, if linked into the similarity graph, the IGDB similarity boost (+50 pts).

**Reviewing matches** — low-confidence matches are flagged for review at Settings → IGDB → Review matches. You can confirm correct matches or reject wrong ones.

---

## Taste Profile

### How the Profile is Computed

The profile is recomputed each time a meaningful or marathon session closes, and can be triggered manually from `/profile`.

**Input data:**
- All scrobbler sessions with a non-noise classification
- `game_inherited_stats` rows (from `gamelist:import`) for games never scrobbled
- User ratings (love / like / dislike / unknown)

**Algorithm:**

For each session, a contribution is computed:

```
contribution = decay × classificationWeight × ratingWeight
```

- **`decay`** — exponential decay with a 90-day half-life: `0.5 ^ (daysSince / 90)`. Recent sessions count more.
- **`classificationWeight`** — `noise`: 0 (ignored), `bounce`: −0.5, `taste`: 0.3, `meaningful`: 1.0, `marathon`: 2.0.
- **`ratingWeight`** — `love`: 2.0, `like`: 1.3, `unknown`: 1.0, `dislike`: −1.5.
- Inherited stats (from `gamelist:import`) receive an additional ×0.7 penalty since they are less precise than live scrobbler data.

The contribution is distributed to the game's attributes: system, genres, decade, developer.

Each dimension (systems, genres, decades, developers) is normalised by its maximum value, producing weights in [0, 1]. The top 15 items per dimension are kept.

**Comfort games** — top 10 games by weighted engagement score, used as IGDB similarity anchors.

**Bouncer games** — games where the bounce score exceeds 1.5× the engagement score. Excluded from recommendations unless rated "love".

### Profile Maturity

```
maturity = min(1, signalSessions / 50)
```

A signal session is any session with a positive contribution (noise and dislike sessions don't count). With 50+ signal sessions the profile is considered fully mature. Below that, recommendations still work but confidence levels lean toward `exploration`.

### What the Profile Page Shows

| Section | Description |
| ------- | ----------- |
| Maturity score | % of target signal sessions reached |
| Signal session count | Number of sessions that contributed positively to the profile |
| System / genre / decade / developer weights | Visual bars; the highest-weighted item = 1.0 |
| Comfort games | Top 10 games by engagement score, used as IGDB anchors |
| Recommendation quality | Launch rate, hit rate, bounce rate over 30 days (see below) |

---

## Recommendation Quality Metrics

The `/profile` page shows a 30-day quality report for recommendations:

| Metric | Definition |
| ------ | ---------- |
| Launch rate | Recommendations that were launched (%) |
| Hit rate | Of launched games, those that led to a meaningful or marathon session (%) |
| Bounce rate | Of launched games, those that ended as a bounce session (%) |
| Skip rate | Recommendations explicitly skipped (%) |

Metrics are broken down by **mood** and **confidence level** so you can see which combinations work best for you.

---

## Session Feedback

### When Prompts Appear

After each session that is not classified as `noise`, the scrobbler checks:

1. Has the user already rated this game in the last 30 days with a non-unknown rating? → skip.
2. Are there already 5+ unanswered feedback prompts in the queue? → skip (queue saturation).
3. Otherwise → create a pending feedback prompt.

The prompt appears as a toast in the dashboard the next time you open it. All pending prompts are also accessible at `/feedback`.

### Ratings and Their Effect

| Rating | Recommendation score effect | Profile computation weight |
| ------ | --------------------------- | -------------------------- |
| `love` | +35 pts; never excluded | ×2.0 |
| `like` | +15 pts | ×1.3 |
| `dislike` | Hard exclusion from all recommendations | ×−1.5 |
| `unknown` | Neutral (0 pts) | ×1.0; allows re-prompting on next session |

---

## Session Engagement Classification

Every session recorded by the scrobbler receives a classification based on its duration:

| Classification | Duration | Signal |
| -------------- | -------- | ------ |
| `noise` | < 2 min | Ignored — accidental launch or crash |
| `bounce` | 2–10 min | Weak negative signal — the user tried but left quickly |
| `taste` | 10–30 min | Neutral — gave it a real try |
| `meaningful` | 30 min–2 h | Positive signal — genuine play session |
| `marathon` | > 2 h | Strong positive signal — immersive session |

Classifications are used across the whole system:

- **Profile computation** — as the `classificationWeight` factor
- **Recommendation scoring** — confirmed taste detection (≥ 3 meaningful or ≥ 1 marathon), bouncer detection
- **Quality metrics** — hit rate counts meaningful + marathon sessions after a launched recommendation
- **Feedback prompts** — noise sessions never trigger a prompt

---

## Configuration

### Enabling IGDB

1. Register an application at [dev.twitch.tv/console/apps](https://dev.twitch.tv/console/apps) to get a **Client ID** and **Client Secret**.
2. Go to **Settings → IGDB** and enter the credentials.
3. Click **Test connection** and save.
4. IGDB matching runs lazily in the background — no manual trigger needed.

### Reviewing IGDB Matches

Low-confidence matches are flagged for review automatically:

1. Go to **Settings → IGDB → Review matches**.
2. Confirm correct matches or reject wrong ones.
3. Confirmed matches are never re-matched; rejected entries are excluded from IGDB enrichment.

### Disabling IGDB

Toggle the integration off in Settings → IGDB. Existing matches are preserved and will be reused if you re-enable later.
