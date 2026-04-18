# Supabase Full Migration

Run this in Supabase SQL Editor to create or upgrade the current schema for sessions, check-ins, interventions, HRV fields, and policies.

```sql
create extension if not exists pgcrypto;

create table if not exists public.sensor_sessions (
  id uuid primary key default gen_random_uuid(),
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

alter table public.sensor_sessions
  add column if not exists duration_seconds integer,
  add column if not exists avg_heart_rate numeric(6,2),
  add column if not exists avg_rr_ms numeric(7,2),
  add column if not exists rr_variability_ms numeric(7,2),
  add column if not exists avg_hrv_ms numeric(7,2),
  add column if not exists last_hrv_ms numeric(7,2),
  add column if not exists max_heart_rate integer,
  add column if not exists sample_count integer default 0,
  add column if not exists session_summary jsonb;

create table if not exists public.check_ins (
  id uuid primary key default gen_random_uuid(),
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

alter table public.check_ins
  add column if not exists sensor_session_id uuid,
  add column if not exists heart_rate integer,
  add column if not exists rr_ms integer,
  add column if not exists hrv_ms numeric(7,2),
  add column if not exists session_elapsed_seconds integer,
  add column if not exists stressor text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'check_ins_sensor_session_id_fkey'
  ) then
    alter table public.check_ins
      add constraint check_ins_sensor_session_id_fkey
      foreign key (sensor_session_id)
      references public.sensor_sessions(id)
      on delete set null;
  end if;
end $$;

create index if not exists check_ins_sensor_session_id_idx
  on public.check_ins(sensor_session_id);

create table if not exists public.interventions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  sensor_session_id uuid references public.sensor_sessions(id) on delete set null,
  check_in_id uuid references public.check_ins(id) on delete set null,
  intervention_type text not null,
  trigger_level text not null check (trigger_level in ('rising', 'high')),
  notes text
);

alter table public.interventions
  add column if not exists sensor_session_id uuid,
  add column if not exists check_in_id uuid,
  add column if not exists intervention_type text,
  add column if not exists trigger_level text,
  add column if not exists notes text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'interventions_sensor_session_id_fkey'
  ) then
    alter table public.interventions
      add constraint interventions_sensor_session_id_fkey
      foreign key (sensor_session_id)
      references public.sensor_sessions(id)
      on delete set null;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'interventions_check_in_id_fkey'
  ) then
    alter table public.interventions
      add constraint interventions_check_in_id_fkey
      foreign key (check_in_id)
      references public.check_ins(id)
      on delete set null;
  end if;
end $$;

create index if not exists interventions_sensor_session_id_idx
  on public.interventions(sensor_session_id);

create index if not exists interventions_check_in_id_idx
  on public.interventions(check_in_id);

alter table public.check_ins enable row level security;
alter table public.sensor_sessions enable row level security;
alter table public.interventions enable row level security;

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

drop policy if exists "Allow public read sessions" on public.sensor_sessions;
create policy "Allow public read sessions"
  on public.sensor_sessions for select
  to anon
  using (true);
```

## Notes

- This file is intended to be safe for both fresh setups and existing projects that need additive upgrades.
- The `do $$ ... $$;` blocks avoid re-adding foreign key constraints if they already exist.
- `pgcrypto` is enabled so `gen_random_uuid()` works reliably.
