# Supabase Full Migration

Run this in Supabase SQL Editor to create or upgrade the current schema for OAuth-backed users, sessions, check-ins, interventions, HRV fields, indexes, and RLS policies.

```sql
create extension if not exists pgcrypto;

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
  body_load_state text check (body_load_state in ('settling', 'steady', 'activated', 'recovering')),
  body_load_score numeric(5,2),
  body_load_confidence text check (body_load_confidence in ('low', 'possible', 'likely')),
  burnout_score numeric(5,2),
  sustained_stress_seconds integer not null default 0,
  signal_quality jsonb,
  activation_event_count integer not null default 0,
  recovery_event_count integer not null default 0,
  sample_count integer not null default 0,
  device_name text,
  capture_type text,
  raw_data_path text,
  summary_payload jsonb,
  session_summary jsonb
);

insert into storage.buckets (id, name, public)
values ('diagnostic-raw', 'diagnostic-raw', false)
on conflict (id) do nothing;

alter table public.sensor_sessions
  add column if not exists user_id uuid,
  add column if not exists duration_seconds integer,
  add column if not exists avg_heart_rate numeric(6,2),
  add column if not exists avg_rr_ms numeric(7,2),
  add column if not exists rr_variability_ms numeric(7,2),
  add column if not exists avg_hrv_ms numeric(7,2),
  add column if not exists last_hrv_ms numeric(7,2),
  add column if not exists max_heart_rate integer,
  add column if not exists body_load_state text,
  add column if not exists body_load_score numeric(5,2),
  add column if not exists body_load_confidence text,
  add column if not exists burnout_score numeric(5,2),
  add column if not exists sustained_stress_seconds integer default 0,
  add column if not exists signal_quality jsonb,
  add column if not exists activation_event_count integer default 0,
  add column if not exists recovery_event_count integer default 0,
  add column if not exists sample_count integer default 0,
  add column if not exists device_name text,
  add column if not exists capture_type text,
  add column if not exists raw_data_path text,
  add column if not exists summary_payload jsonb,
  add column if not exists session_summary jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'sensor_sessions_user_id_fkey'
  ) then
    alter table public.sensor_sessions
      add constraint sensor_sessions_user_id_fkey
      foreign key (user_id)
      references auth.users(id)
      on delete cascade;
  end if;
end $$;

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

alter table public.check_ins
  add column if not exists user_id uuid,
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
    where conname = 'check_ins_user_id_fkey'
  ) then
    alter table public.check_ins
      add constraint check_ins_user_id_fkey
      foreign key (user_id)
      references auth.users(id)
      on delete cascade;
  end if;
end $$;

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

alter table public.interventions
  add column if not exists user_id uuid,
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
    where conname = 'interventions_user_id_fkey'
  ) then
    alter table public.interventions
      add constraint interventions_user_id_fkey
      foreign key (user_id)
      references auth.users(id)
      on delete cascade;
  end if;
end $$;

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

create index if not exists interventions_user_id_idx
  on public.interventions(user_id);

create table if not exists public.body_load_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  sensor_session_id uuid references public.sensor_sessions(id) on delete cascade,
  created_at timestamptz not null default now(),
  session_elapsed_seconds integer,
  label text not null check (label in ('felt_stressed', 'normal_focus', 'caffeine_illness_sleep')),
  body_load_state text check (body_load_state in ('settling', 'steady', 'activated', 'recovering')),
  body_load_confidence text check (body_load_confidence in ('low', 'possible', 'likely')),
  signal_quality jsonb,
  related_event_id text,
  context_tags text[] not null default '{}'
);

create index if not exists body_load_feedback_user_id_idx
  on public.body_load_feedback(user_id);

create index if not exists body_load_feedback_sensor_session_id_idx
  on public.body_load_feedback(sensor_session_id);

create index if not exists sensor_sessions_user_id_idx
  on public.sensor_sessions(user_id);

create index if not exists sensor_sessions_raw_data_path_idx
  on public.sensor_sessions(raw_data_path);

alter table public.check_ins enable row level security;
alter table public.sensor_sessions enable row level security;
alter table public.interventions enable row level security;
alter table public.body_load_feedback enable row level security;

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

drop policy if exists "Users can insert own body_load_feedback" on public.body_load_feedback;
create policy "Users can insert own body_load_feedback"
  on public.body_load_feedback for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can read own body_load_feedback" on public.body_load_feedback;
create policy "Users can read own body_load_feedback"
  on public.body_load_feedback for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can upload own diagnostic raw data" on storage.objects;
create policy "Users can upload own diagnostic raw data"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'diagnostic-raw'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users can read own diagnostic raw data" on storage.objects;
create policy "Users can read own diagnostic raw data"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'diagnostic-raw'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users can update own diagnostic raw data" on storage.objects;
create policy "Users can update own diagnostic raw data"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'diagnostic-raw'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'diagnostic-raw'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
```

## Notes

- This file is intended to be safe for both fresh setups and existing projects that need additive upgrades.
- The `do $$ ... $$;` blocks avoid re-adding foreign key constraints if they already exist.
- `pgcrypto` is enabled so `gen_random_uuid()` works reliably.
- OAuth providers must still be enabled in Supabase Auth, with the correct site URL and redirect URLs configured in the Supabase dashboard.




alter table public.sensor_sessions
  add column if not exists device_name text,
  add column if not exists capture_type text,
  add column if not exists diagnostic_payload jsonb;
