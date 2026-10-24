-- Supabase hardening migration (CSES + QOJ Premier Weekly)
--
-- Run ONCE in the Supabase SQL editor (Dashboard -> SQL Editor -> New query)
-- on the live project. It is idempotent: re-running it is a no-op.
-- It does not delete or rewrite any data in public.progress / public.profiles.
--
-- What it does:
--   1. profiles: users may only UPDATE their own qoj_handle. No INSERT/DELETE,
--      no editing username/avatar_url (those come from GitHub via the
--      handle_new_user() trigger, which is SECURITY DEFINER and owned by
--      postgres, so it bypasses RLS and these grants).
--      qoj_handle must be NULL or match ^[A-Za-z0-9_.-]{1,40}$
--      (same as HANDLE_RE in qoj/assets/profile.js).
--   2. progress.problem_id must look like '<digits>' (CSES) or 'qoj:<digits>'.
--   3. handle_new_user(): pinned search_path, EXECUTE revoked from API roles.
--   4. Partial index on progress(problem_id) WHERE done for the
--      `.in('problem_id', ...).eq('done', true)` leaderboard queries.
--
-- Optional pre-checks (read-only) -- both should return 0 rows before running:
--
--   select user_id, problem_id from public.progress
--    where problem_id !~ '^(qoj:)?[0-9]{1,7}$';
--
--   select user_id, qoj_handle from public.profiles
--    where qoj_handle is not null and qoj_handle !~ '^[A-Za-z0-9_.-]{1,40}$';

begin;

-- ── 1. profiles: UPDATE-only, qoj_handle column only ──────────────────────────

alter table public.profiles add column if not exists qoj_handle text;

drop policy if exists "Users manage own profile" on public.profiles;
drop policy if exists "Users update own profile" on public.profiles;
create policy "Users update own profile"
  on public.profiles
  for update
  to authenticated
  using      ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Table-level write privileges are removed; only the qoj_handle column stays
-- writable (RLS above still restricts it to the caller's own row).
-- TRUNCATE ignores RLS, so drop it too (not exposed by PostgREST, but cheap).
revoke insert, update, delete, truncate on public.profiles from anon, authenticated;
grant update (qoj_handle) on public.profiles to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.profiles'::regclass
       and conname  = 'profiles_qoj_handle_format'
  ) then
    alter table public.profiles
      add constraint profiles_qoj_handle_format
      check (qoj_handle is null or qoj_handle ~ '^[A-Za-z0-9_.-]{1,40}$')
      not valid;
  end if;
end $$;
alter table public.profiles validate constraint profiles_qoj_handle_format;

-- ── 2. progress.problem_id format ─────────────────────────────────────────────
-- CSES ids are bare integers (e.g. '1068'); QOJ ids are 'qoj:<int>' (e.g. 'qoj:20260').

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.progress'::regclass
       and conname  = 'progress_problem_id_format'
  ) then
    alter table public.progress
      add constraint progress_problem_id_format
      check (problem_id ~ '^(qoj:)?[0-9]{1,7}$')
      not valid;
  end if;
end $$;
alter table public.progress validate constraint progress_problem_id_format;

revoke truncate on public.progress from anon, authenticated;

-- ── 3. SECURITY DEFINER functions ─────────────────────────────────────────────
-- handle_new_user() is only ever called by the on_auth_user_created trigger;
-- trigger execution does not need EXECUTE privilege for the calling role.
alter function public.handle_new_user() set search_path = public;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- NOTE: the live DB also has public.rls_auto_enable() (SECURITY DEFINER,
-- search_path = pg_catalog) backing the `ensure_rls` event trigger. It is not
-- in this repo and is intentionally NOT touched here. It is EXECUTE-able by
-- PUBLIC/anon/authenticated; inspect it and, if you agree, run:
--   revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
-- (event-trigger functions cannot be called directly anyway, so this is tidy-up.)

-- ── 4. Index for leaderboard queries ──────────────────────────────────────────
-- The PK (user_id, problem_id) cannot serve `problem_id in (...) and done`.
create index if not exists progress_problem_done_idx
  on public.progress (problem_id)
  where done;

commit;
