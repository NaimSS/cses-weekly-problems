-- Run this in the Supabase SQL editor (Dashboard → SQL Editor → New query)

create table public.progress (
  user_id    uuid        not null references auth.users on delete cascade,
  problem_id text        not null,
  done       boolean     not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, problem_id)
);

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

create policy "Users manage own profile"
  on public.profiles
  for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

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
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert or update on auth.users
  for each row execute procedure public.handle_new_user();
