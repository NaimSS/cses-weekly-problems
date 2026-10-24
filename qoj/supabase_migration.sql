-- QOJ Premier Weekly: run once in the Supabase SQL editor (Dashboard → SQL Editor → New query)

-- User-chosen QOJ handle, shown instead of the GitHub username.
-- The existing handle_new_user() trigger only writes username/avatar_url,
-- so this survives re-logins. Write access (UPDATE of qoj_handle only, own row)
-- is set up by supabase_hardening.sql at the repo root.
alter table public.profiles add column if not exists qoj_handle text;

-- QOJ progress rows live in public.progress with problem_id = 'qoj:<id>'.
