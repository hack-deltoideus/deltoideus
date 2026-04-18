-- Stress Buddy MVP schema for Supabase
-- Apply in Supabase SQL editor

create table if not exists public.check_ins (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  mood smallint not null check (mood between 1 and 10),
  workload smallint not null check (workload between 1 and 10),
  sleep_quality smallint not null check (sleep_quality between 1 and 10),
  stress_score numeric(5,2) not null,
  stress_level text not null check (stress_level in ('low', 'rising', 'high')),
  heart_rate integer,
  rr_ms integer,
  rmssd_ms numeric(7,2),
  ln_rmssd numeric(7,3),
  sdnn_ms numeric(7,2),
  recovery_status text check (recovery_status in ('green', 'yellow', 'red')),
  cognitive_strain_risk text check (cognitive_strain_risk in ('low', 'medium', 'high')),
  baseline_heart_rate numeric(6,2),
  baseline_ln_rmssd numeric(7,3),
  baseline_sdnn_ms numeric(7,2),
  baseline_ready boolean not null default false,
  stressor text
);

alter table public.check_ins add column if not exists rmssd_ms numeric(7,2);
alter table public.check_ins add column if not exists ln_rmssd numeric(7,3);
alter table public.check_ins add column if not exists sdnn_ms numeric(7,2);
alter table public.check_ins add column if not exists recovery_status text;
alter table public.check_ins add column if not exists cognitive_strain_risk text;
alter table public.check_ins add column if not exists baseline_heart_rate numeric(6,2);
alter table public.check_ins add column if not exists baseline_ln_rmssd numeric(7,3);
alter table public.check_ins add column if not exists baseline_sdnn_ms numeric(7,2);
alter table public.check_ins add column if not exists baseline_ready boolean not null default false;

create table if not exists public.baseline_readings (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  reading_label text,
  heart_rate numeric(6,2),
  rr_ms integer,
  rmssd_ms numeric(7,2),
  ln_rmssd numeric(7,3),
  sdnn_ms numeric(7,2),
  sample_count integer not null default 0
);

create table if not exists public.stress_windows (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  label text not null check (label in ('calm', 'okay', 'stressed')),
  note text,
  window_seconds integer not null default 60,
  heart_rate_avg numeric(6,2),
  heart_rate_max integer,
  rr_ms integer,
  rr_series jsonb not null default '[]'::jsonb,
  rr_count integer not null default 0,
  rmssd_ms numeric(7,2),
  ln_rmssd numeric(7,3),
  sdnn_ms numeric(7,2),
  baseline_ready boolean not null default false,
  baseline_heart_rate numeric(6,2),
  baseline_ln_rmssd numeric(7,3),
  baseline_sdnn_ms numeric(7,2)
);

create table if not exists public.sensor_sessions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  avg_heart_rate numeric(6,2),
  max_heart_rate integer,
  sample_count integer not null default 0
);

create table if not exists public.interventions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  intervention_type text not null,
  trigger_level text not null check (trigger_level in ('rising', 'high')),
  notes text
);

alter table public.check_ins enable row level security;
alter table public.baseline_readings enable row level security;
alter table public.stress_windows enable row level security;
alter table public.sensor_sessions enable row level security;
alter table public.interventions enable row level security;

-- Hackathon-only open policy. Tighten this before production.
drop policy if exists "Allow public insert check_ins" on public.check_ins;
create policy "Allow public insert check_ins"
  on public.check_ins for insert
  to anon
  with check (true);

drop policy if exists "Allow public read check_ins" on public.check_ins;
create policy "Allow public read check_ins"
  on public.check_ins for select
  to anon
  using (true);

drop policy if exists "Allow public insert baseline_readings" on public.baseline_readings;
create policy "Allow public insert baseline_readings"
  on public.baseline_readings for insert
  to anon
  with check (true);

drop policy if exists "Allow public read baseline_readings" on public.baseline_readings;
create policy "Allow public read baseline_readings"
  on public.baseline_readings for select
  to anon
  using (true);

drop policy if exists "Allow public insert stress_windows" on public.stress_windows;
create policy "Allow public insert stress_windows"
  on public.stress_windows for insert
  to anon
  with check (true);

drop policy if exists "Allow public read stress_windows" on public.stress_windows;
create policy "Allow public read stress_windows"
  on public.stress_windows for select
  to anon
  using (true);

drop policy if exists "Allow public delete baseline_readings" on public.baseline_readings;
create policy "Allow public delete baseline_readings"
  on public.baseline_readings for delete
  to anon
  using (true);

drop policy if exists "Allow public insert interventions" on public.interventions;
create policy "Allow public insert interventions"
  on public.interventions for insert
  to anon
  with check (true);

drop policy if exists "Allow public insert sessions" on public.sensor_sessions;
create policy "Allow public insert sessions"
  on public.sensor_sessions for insert
  to anon
  with check (true);

drop policy if exists "Allow public update sessions" on public.sensor_sessions;
create policy "Allow public update sessions"
  on public.sensor_sessions for update
  to anon
  using (true)
  with check (true);
