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
  stressor text
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
alter table public.sensor_sessions enable row level security;
alter table public.interventions enable row level security;

-- Hackathon-only open policy. Tighten this before production.
drop policy if exists "Allow public insert check_ins" on public.check_ins;
create policy "Allow public insert check_ins"
  on public.check_ins for insert
  to anon
  with check (true);

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

drop policy if exists "Allow public read check_ins" on public.check_ins;
create policy "Allow public read check_ins"
  on public.check_ins for select
  to anon
  using (true);
