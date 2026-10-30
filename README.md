# MILF

A small activity board for a group of friends: log activities and weight, grow a fruit tree, and see everyone's progress in a live feed and charts. Runs on Cloudflare's free tier (one Worker + one D1 database).

## What's in it

- **Invite-code sign-up**, username/password login (PBKDF2-hashed), 30-day session cookie
- **Activities**: title, description, type, minutes, distance, date
- **Orchard**: each person grows the fruit tree of their choice (apple, pear, orange, lemon, feijoa, plum, cherry, peach, avocado — picked in Settings). Every activity moves it one step through the seasons: grow (first season) → leaves → flowers → fruit → leaf fall → leaves… In the fruit stage each activity feeds one fruit; ripe fruit drop into the basket. ~65 activities and ~5 fruit per season. Deterministic, so it looks the same on every load. Tuning is the `ORCHARD` constant in `src/index.js`
- **Weight**: one weigh-in (kg) per person per day, plus an optional target shown as ▲/▼ kg over/under
- **Feed** down the side showing what everyone's been doing, grouped by day
- **Dashboard**: everyone's tree and basket, leaderboard ranked by fruit, activity race, activities per day, everyone's weight, minutes per person, activity types
- **Profiles**: big tree + basket, streaks, totals, height/weight, weekly activity, weight trend, full history (edit/delete your own)
- **REST API** with a personal API key per person — docs are on the in-app **API** page

Everything is visible to every logged-in member; you can only change your own data.

## Deploy (about 5 minutes)

You need Node 18+ and a free Cloudflare account.

```bash
npm install
npx wrangler login

# 1. Create the database, then paste the printed database_id into wrangler.toml
npx wrangler d1 create move-club

# 2. Set the invite code your friends will use to sign up
npx wrangler secret put INVITE_CODE

# 3. Create the tables and deploy
npm run deploy
```

Wrangler prints your URL (e.g. `https://move-club.<you>.workers.dev`). Send friends the link and the invite code. To close sign-ups once everyone's in: `npx wrangler secret delete INVITE_CODE`.

## Run locally

```bash
echo "INVITE_CODE=letsgo" > .dev.vars
npm run dev        # http://localhost:8787
```

## Settings (`wrangler.toml` → `[vars]`)

| Var | Default | |
|---|---|---|
| `APP_NAME` | Move Club | Shown in the header and tab |
| `TIMEZONE` | Pacific/Auckland | Used to work out "today" for dates |
| `PBKDF2_ITERATIONS` | 10000 | Kept low to fit the free plan's 10 ms CPU limit; raise on a paid plan (existing passwords keep working) |

## API quick start

Generate a key in **Settings → API key**, then:

```bash
curl -X POST https://YOUR-URL/api/activities \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"title":"Lunch walk","type":"walk","duration_min":30,"distance_km":2.4}'

curl -X POST https://YOUR-URL/api/weight \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"date":"2026-10-23","weight_kg":78.4}'
```

Endpoints: `GET/POST /api/activities`, `GET/PATCH/DELETE /api/activities/:id`, `GET/POST /api/weight`, `DELETE /api/weight/:date`, `GET /api/feed`, `GET /api/users`, `GET /api/users/:username`, `GET/PATCH /api/me`. Errors are `{"error": "..."}` with a 4xx status.

## Layout

```
src/index.js            Worker: router, auth, all API handlers
migrations/0001_init.sql D1 schema
public/                 Frontend (plain HTML/CSS/JS, Chart.js vendored)
wrangler.toml           Cloudflare config
```
