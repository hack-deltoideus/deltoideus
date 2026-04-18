create table if not exists public.sensor_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_seconds integer,
  avg_heart_rate numeric(6,2),
  avg_rr_ms numeric(7,2),
  rr_variability_ms numeric(7,2),
  avg_hrv_ms numeric(7,2),
  last_hrv_ms numeric(7,2),
  max_heart_rate integer,
  sample_count integer not null default 0,
  session_summary jsonb
);

create table if not exists public.check_ins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  sensor_session_id uuid references public.sensor_sessions(id) on delete set null,
  mood smallint not null check (mood between 1 and 10),
  workload smallint not null check (workload between 1 and 10),
  sleep_quality smallint not null check (sleep_quality between 1 and 10),
  stress_score numeric(5,2) not null,
  stress_level text not null check (stress_level in ('low', 'rising', 'high')),
  heart_rate integer,
  rr_ms integer,
  hrv_ms numeric(7,2),
  session_elapsed_seconds integer,
  stressor text
);

create index if not exists check_ins_sensor_session_id_idx
  on public.check_ins(sensor_session_id);

create index if not exists check_ins_user_id_idx
  on public.check_ins(user_id);

create table if not exists public.interventions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  sensor_session_id uuid references public.sensor_sessions(id) on delete set null,
  check_in_id uuid references public.check_ins(id) on delete set null,
  intervention_type text not null,
  trigger_level text not null check (trigger_level in ('rising', 'high')),
  notes text
);

create index if not exists interventions_sensor_session_id_idx
  on public.interventions(sensor_session_id);

create index if not exists interventions_check_in_id_idx
  on public.interventions(check_in_id);

create index if not exists interventions_user_id_idx
  on public.interventions(user_id);

create index if not exists sensor_sessions_user_id_idx
  on public.sensor_sessions(user_id);

alter table public.check_ins enable row level security;
alter table public.sensor_sessions enable row level security;
alter table public.interventions enable row level security;

-- Hackathon-only open policy. Tighten this before production.
drop policy if exists "Allow public insert check_ins" on public.check_ins;
drop policy if exists "Users can insert own check_ins" on public.check_ins;
create policy "Users can insert own check_ins"
  on public.check_ins for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Allow public insert interventions" on public.interventions;
drop policy if exists "Users can insert own interventions" on public.interventions;
create policy "Users can insert own interventions"
  on public.interventions for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Allow public insert sessions" on public.sensor_sessions;
drop policy if exists "Users can insert own sessions" on public.sensor_sessions;
create policy "Users can insert own sessions"
  on public.sensor_sessions for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Allow public update sessions" on public.sensor_sessions;
drop policy if exists "Users can update own sessions" on public.sensor_sessions;
create policy "Users can update own sessions"
  on public.sensor_sessions for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Allow public read check_ins" on public.check_ins;
drop policy if exists "Users can read own check_ins" on public.check_ins;
create policy "Users can read own check_ins"
  on public.check_ins for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Allow public read sessions" on public.sensor_sessions;
drop policy if exists "Users can read own sessions" on public.sensor_sessions;
create policy "Users can read own sessions"
  on public.sensor_sessions for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can read own interventions" on public.interventions;
create policy "Users can read own interventions"
  on public.interventions for select
  to authenticated
  using (auth.uid() = user_id);
