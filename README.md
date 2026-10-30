# MILF

A small activity board for a group of friends: log activities and weight, grow a fruit tree, and see everyone's progress in a live feed and charts. Runs on Cloudflare's free tier (one Worker + one D1 database).

## What's in it

- **Invite-code sign-up**, username/password login (PBKDF2-hashed), 30-day session cookie
- **Activities**: title, description, type, minutes, distance, date
- **Orchard**: each person grows the fruit tree of their choice (apple, pear, orange, lemon, feijoa, plum, cherry, peach, avocado — picked in Settings). Every activity moves it one step through the seasons: grow (first season) → leaves → flowers → fruit → leaf fall → leaves… In the fruit stage each activity feeds one fruit; ripe fruit drop into the basket. ~65 activities and ~5 fruit per season. Deterministic, so it looks the same on every load. Tuning is the `ORCHARD` constant in `src/index.js`
- **Weight & BMI**: one weigh-in (kg) per person per day, an optional target shown as ▲/▼ kg over/under, and BMI from height in Settings. Opt-in **Māori Mode** (Settings) takes 30 kg off weight in the BMI calculation and tags you on the BMI chart
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

```powershell
npm install
Set-Content -Path .dev.vars -Value "INVITE_CODE=letsgo" -Encoding ascii   # Mac/Linux: echo "INVITE_CODE=letsgo" > .dev.vars
npm run dev        # http://localhost:8787
```

This uses a throwaway database on your own computer, not the real one.

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

## How to contribute

Anyone in the group can suggest a change. Nobody (including the owner) changes the live site directly — every change goes through a **pull request** that the owner reviews first.

1. **Fork** this repo (button at the top right of the GitHub page) — that gives you your own copy.
2. Make your change on a **branch** in your copy and test it on your own computer (`npm run dev`).
3. Open a **pull request** back to this repo, filling in the checklist GitHub shows you (from `pull_request_template.md`).
4. The owner reviews it, may ask for tweaks, then merges it and deploys.

**What gets approved quickly**
- One feature or fix per pull request. Small is good.
- You've run it locally and clicked around (see the checklist below).
- A clear description of what changed and why, with a screenshot if it changes how something looks.

**What needs extra care**
- Anything in `migrations/` — this changes the real database. Add a **new** numbered file (e.g. `0004_something.sql`); never edit an existing one. Say so clearly in the pull request.
- Anything touching login, passwords, sessions or API keys.
- New libraries or packages — the app deliberately has none besides Chart.js. Ask first.

**Never commit**
- `.dev.vars`, passwords, API keys or anything from your Cloudflare account. (`.gitignore` already blocks `.dev.vars`.)

New to all this? The next section walks you through everything.

---

## Adding features for dummies

A step-by-step guide for adding a feature with help from a free AI chat (Claude at **claude.ai** or ChatGPT at **chatgpt.com**), even if you've never coded before. Written for Windows; Mac notes in brackets.

### Part 1 — Set up your computer (once, about 20 minutes)

You need four free things:

| What | Where | Why |
|---|---|---|
| **GitHub account** | github.com/signup | To get a copy of the code and send your changes back |
| **Git** | git-scm.com/download/win — install with all defaults *(Mac: run `git --version` in Terminal and accept the install prompt)* | Tracks your changes |
| **Node.js (LTS)** | nodejs.org — the big "LTS" button, install with defaults | Runs the app on your computer |
| **VS Code** | code.visualstudio.com | A friendly editor for the code files |

Then open **PowerShell** (Start → type "PowerShell") *(Mac: Terminal)* and check everything installed:

```powershell
git --version
node -v
npm -v
```

Each should print a version number. If PowerShell says *"running scripts is disabled on this system"*, run this once and answer **Y**:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

Tell Git who you are (use the same email as your GitHub account):

```powershell
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

### Part 2 — Get your own copy of the app (once)

1. Go to this repo on GitHub and click **Fork** (top right) → **Create fork**. You now have `github.com/YOUR-NAME/Physical-Activity-Tracker`.
2. Download your copy and set it up:

```powershell
cd $HOME\Documents
git clone https://github.com/YOUR-NAME/Physical-Activity-Tracker.git
cd Physical-Activity-Tracker
git remote add upstream https://github.com/pollo-loco-nz/Physical-Activity-Tracker.git
npm install
Set-Content -Path .dev.vars -Value "INVITE_CODE=letsgo" -Encoding ascii
```

*(Mac: replace the last line with `echo "INVITE_CODE=letsgo" > .dev.vars`.)*

3. Start the app:

```powershell
npm run dev
```

4. Open **http://localhost:8787** in your browser, click **Join**, use invite code **letsgo**, and make a test account. Log a few activities so there's something to look at.

This is your own private playground — a fake database on your computer. Nothing you do here touches the real site or anyone's real data. Press **Ctrl+C** in PowerShell to stop it.

> Open the project in VS Code with: `code .` (or File → Open Folder).

### Part 3 — Add a feature (every time)

**Step 1. Start fresh.** Get the latest code from the main repo and make a branch named after your feature:

```powershell
cd $HOME\Documents\Physical-Activity-Tracker
git checkout main
git pull upstream main
git checkout -b my-feature-name
```

Use a short name with dashes, e.g. `streak-badges` or `bigger-trees`.

**Step 2. Work out which file(s) you need.** Most features only touch one or two:

| If you want to change… | Look in |
|---|---|
| How pages look or what they show (dashboard, profile, feed, charts, trees) | `public/app.js` |
| Colours, sizes, spacing, layout | `public/styles.css` |
| The log form, the login screen, the page frame | `public/index.html` |
| What's saved, rules, the API, how trees grow (`ORCHARD`) | `src/index.js` |
| Adding a new database column or table | a **new** file in `migrations/` |

**Step 3. Ask the AI.** Start a **new chat**, attach the file(s) from step 2 using the 📎 / **+** button, and paste this prompt, filling in the last line:

```text
I'm adding a feature to a small fitness app for a group of friends.
Tech: a Cloudflare Worker (src/index.js) with a D1 SQLite database, and a
frontend of plain HTML, CSS and JavaScript (public/), with Chart.js for charts.
There is NO build step, NO framework (no React etc.) and NO npm packages besides wrangler.

Rules for your answer:
- Keep the same style as the existing code. Don't add libraries or frameworks.
- Don't rewrite whole files. For each change, tell me the file, the exact
  existing lines to find, and the exact lines to replace them with.
- If the database needs a new column or table, give me a NEW migration file
  (next number after the ones in migrations/) — never change an existing one.
- Keep it working on phones and in dark mode.
- Tell me exactly how to test it.

The feature I want: <describe it in plain English, e.g. "show a 🔥 next to
anyone's name on the leaderboard who has logged something 3 days in a row">
```

Tips for free AI accounts:
- **Attach files rather than pasting.** `public/app.js` is long; attaching it is more reliable.
- **One feature per chat.** If the chat gets long or the AI starts forgetting things, start a new chat and attach the files again.
- **If you hit the free message limit,** wait for it to reset or try the other AI — the prompt works in both.
- **Ask it to explain** anything you don't understand: *"What does this change do, in plain English?"*

**Step 4. Make the changes in VS Code.** For each change the AI gives you:
1. Open the file and press **Ctrl+F** (*Mac: Cmd+F*) to find the existing lines it quoted.
2. Select them and paste the replacement.
3. Save with **Ctrl+S**.

If you can't find the lines it quoted, tell the AI: *"I can't find those lines — here's the current section:"* and paste the nearby code.

**Step 5. Test it.** Run `npm run dev` (if it isn't already running), refresh **http://localhost:8787**, and go through this checklist:

- [ ] Your feature works and does what you described
- [ ] Log an activity — the toast appears and the feed updates
- [ ] Dashboard, a profile page and Settings all still load
- [ ] Press **F12** → **Console** tab: no red errors
- [ ] Press **F12** → click the phone/tablet icon to check it on a phone-sized screen
- [ ] Check dark mode (Windows: Settings → Personalisation → Colours → Dark)

Then check for typos in the code itself:

```powershell
node --check src/index.js
node --check public/app.js
```

No output means all good. If you changed or added a migration, apply it to your local database before testing:

```powershell
npx wrangler d1 migrations apply move-club --local
```

**Something broke?** Copy the exact error (from PowerShell or the F12 Console) into the same AI chat and ask *"I get this error, how do I fix it?"*. To throw away all your changes and start again: `git checkout .`

**Step 6. Send it in.**

```powershell
git add .
git status
```

Check the list — it should only be the files you meant to change (never `.dev.vars`). Then:

```powershell
git commit -m "Short description of your feature"
git push -u origin my-feature-name
```

Go to your fork on GitHub — there'll be a yellow banner with a **Compare & pull request** button. Click it, fill in the template (what it does, how you tested, a screenshot), and click **Create pull request**.

**Step 7. Wait for review.** The owner may approve it, or comment asking for changes. To update your pull request, just make the changes, then:

```powershell
git add .
git commit -m "Fix review comments"
git push
```

The pull request updates by itself. Once it's merged, it'll go live the next time the owner deploys.

### Common problems

| Problem | Fix |
|---|---|
| `npm` or `npx` "running scripts is disabled" | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, answer **Y** |
| The **Join** tab is missing at localhost | `.dev.vars` is missing or unreadable — run the `Set-Content` line from Part 2 again, then restart `npm run dev` |
| "no such column" / "no such table" errors | Run `npx wrangler d1 migrations apply move-club --local` |
| Page is blank or half-loaded | F12 → Console shows the error — paste it to the AI |
| `git push` says 403 / permission denied | You're pushing to the main repo instead of your fork — check with `git remote -v`; `origin` should be **your** GitHub name |
| Your branch is out of date | `git pull upstream main`, then test again |
| Want a clean slate | `git checkout main`, then `git checkout -b new-branch-name` |
