# deltoideus

## Hackathon MVP: Stress Buddy

Stress Buddy combines quick self check-ins with Polar H9 heart-rate data to catch rising stress and trigger immediate action.

## MVP scope

- Connect to a Polar H9 over Bluetooth LE (Web Bluetooth)
- Display live heart rate and RR interval
- Persist one timestamped JSON summary per sensor session into Supabase, including average heart rate and RR variability
- Attach each check-in to the active sensor session when one exists
- Sign in with Supabase OAuth so each user sees only their own sessions and check-ins
- Run a simple stress score from bio-signal + user input
- Trigger one intervention suggestion based on stress level
- Save check-ins and intervention events to Supabase

## Stack

- SvelteKit + TypeScript
- Web Bluetooth API for Polar H9 heart-rate stream
- Supabase Postgres (and optional Auth later)

## Quick start

1. Install dependencies

```bash
npm install
```

2. Configure env

```bash
cp .env.example .env
```

Set these values in `.env`:

- `PUBLIC_SUPABASE_URL`
- `PUBLIC_SUPABASE_ANON_KEY`
- Enable Google OAuth in Supabase Auth and add your local/dev redirect URLs there
- `OPENAI_API_KEY` or `OPENAI_KEY`
- `OPENAI_MODEL` (optional, defaults to `gpt-4.1-mini`)

3. Create tables in Supabase

- Open SQL Editor in your Supabase project
- Run SQL from `supabase/schema.sql`
- If you already created the earlier MVP tables, re-run the updated schema so `sensor_sessions` has the new summary columns and `summary_payload` JSON field

4. Run app

```bash
npm run dev -- --open
```

## Deploy on Render

1. Push `main` to GitHub
2. In Render, create a new `Web Service` from this repo
3. Render can use the included [render.yaml](/Users/emperor/kelp/deltoideus/render.yaml), or these manual settings:

```bash
Build Command: npm install && npm run build
Start Command: npm run start
```

4. Add these environment variables in Render:

- `PUBLIC_SUPABASE_URL`
- `PUBLIC_SUPABASE_ANON_KEY`
- `OPENAI_API_KEY`
- Optional: `OPENAI_MODEL`

5. In Supabase Auth, add your Render domain to allowed redirect URLs, including:

- `https://YOUR_RENDER_SERVICE.onrender.com`
- `https://YOUR_RENDER_SERVICE.onrender.com/app`

5. Use AI intervention

- Open the Stress Detection card
- The app can call a server endpoint that uses your private OpenAI API key
- The default model is `gpt-4.1-mini`, which keeps latency and cost low for short coaching replies

6. Use Oy Coach

- Open `/app/coach` from the dashboard
- Pick a persona: `Calm Coach`, `Tough Love`, or `Study Planner`
- Use quick prompt chips or type your own question
- Get a concise personality-driven response with one next step
- If OpenAI is temporarily unavailable, the app falls back to a local coach response instead of hard-failing

## Demo script (60 seconds)

1. Connect Polar H9 (or click `Simulate Spike`)
2. Set mood, workload, sleep sliders
3. Show stress level changes in real time
4. Save check-in to Supabase
5. Show inserted rows in `check_ins` and `interventions`

## Notes

- Web Bluetooth works best in Chrome/Edge on HTTPS or localhost.
- The current RLS policies in `supabase/schema.sql` are intentionally open for hackathon speed; lock them down before production.
