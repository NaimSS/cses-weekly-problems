-- Run this in the Supabase SQL editor (Dashboard → SQL Editor → New query)

create table public.progress (
  user_id    uuid        not null references auth.users on delete cascade,
  problem_id text        not null,
  done       boolean     not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, problem_id),
  -- CSES ids are bare integers ('1068'); QOJ ids are 'qoj:<int>'
  constraint progress_problem_id_format check (problem_id ~ '^(qoj:)?[0-9]{1,7}$')
);

-- Serves the leaderboard queries: .in('problem_id', ...).eq('done', true)
create index if not exists progress_problem_done_idx
  on public.progress (problem_id)
  where done;

alter table public.progress enable row level security;

create policy "Users manage their own progress"
  on public.progress
  for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Allow public reads so the rank/leaderboard pages can see everyone's progress
create policy "Public read progress"
  on public.progress
  for select
  using (true);

-- ── Profiles ───────────────────────────────────────────────────────────────────

create table public.profiles (
  user_id    uuid primary key references auth.users on delete cascade,
  username   text,
  avatar_url text
);

alter table public.profiles enable row level security;

create policy "Public read profiles"
  on public.profiles
  for select
  using (true);

-- Users may only UPDATE their own row, and only the qoj_handle column (see the
-- column grant below). username/avatar_url are written solely by the
-- SECURITY DEFINER handle_new_user() trigger. No INSERT/DELETE from the API.
create policy "Users update own profile"
  on public.profiles
  for update
  to authenticated
  using      ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Auto-populate profiles when a user signs in via GitHub OAuth
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (user_id, username, avatar_url)
  values (
    new.id,
    new.raw_user_meta_data->>'user_name',
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (user_id) do update set
    username   = excluded.username,
    avatar_url = excluded.avatar_url;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- Only the trigger calls this; trigger execution needs no EXECUTE grant.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert or update on auth.users
  for each row execute procedure public.handle_new_user();

-- ── QOJ Premier Weekly ─────────────────────────────────────────────────────────

-- User-chosen QOJ handle (see qoj/supabase_migration.sql)
alter table public.profiles add column if not exists qoj_handle text;
alter table public.profiles drop constraint if exists profiles_qoj_handle_format;
alter table public.profiles
  add constraint profiles_qoj_handle_format
  check (qoj_handle is null or qoj_handle ~ '^[A-Za-z0-9_.-]{1,40}$');  -- = HANDLE_RE in qoj/assets/profile.js

-- ── Privileges ─────────────────────────────────────────────────────────────────
-- (Equivalent hardening for an existing DB lives in supabase_hardening.sql.)
-- profiles: API roles can read everything but write only their own qoj_handle.
revoke insert, update, delete, truncate on public.profiles from anon, authenticated;
grant update (qoj_handle) on public.profiles to authenticated;
-- TRUNCATE bypasses RLS; PostgREST doesn't expose it, but drop it anyway.
revoke truncate on public.progress from anon, authenticated;
