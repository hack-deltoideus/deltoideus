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
- Enable at least one OAuth provider in Supabase Auth (the app supports Google and GitHub)
- `GEMINI_KEY` (or `GEMINI_API_KEY` / `GOOGLE_API_KEY`)
- `GEMINI_MODEL` (optional, defaults to `gemini-2.5-flash-lite`)

3. Create tables in Supabase

- Open SQL Editor in your Supabase project
- Run SQL from `supabase/schema.sql`
- If you already created the earlier MVP tables, re-run the updated schema so `sensor_sessions` has the new summary columns and `session_summary` JSON field

4. Run app

```bash
npm run dev -- --open
```

5. Use AI intervention

- Open the Stress Detection card
- Click `Generate Gemini Plan`
- The app calls a server endpoint that uses `GEMINI_KEY` privately
- If you hit free-tier rate limits often, use `gemini-2.5-flash-lite`

6. Use Kelp personality helper

- Open `Ask Kelp (Gemini Helper)`
- Pick a persona: `Calm Coach`, `Tough Love`, or `Study Planner`
- Use quick prompt chips or type your own question
- Get a concise personality-driven response with one next step
- Keep context with recent chat memory in the UI

## Demo script (60 seconds)

1. Connect Polar H9 (or click `Simulate Spike`)
2. Set mood, workload, sleep sliders
3. Show stress level changes in real time
4. Save check-in to Supabase
5. Show inserted rows in `check_ins` and `interventions`

## Notes

- Web Bluetooth works best in Chrome/Edge on HTTPS or localhost.
- The current RLS policies in `supabase/schema.sql` are intentionally open for hackathon speed; lock them down before production.
