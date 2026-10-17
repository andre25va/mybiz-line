-- 009: deny anon and authenticated access to MyBiz Line tables.
-- The server uses service_role, which has BYPASSRLS on this project, so login,
-- contacts, tasks, drafts, the dispatcher, and cron keep working.
-- Do not use FORCE ROW LEVEL SECURITY. That would also apply to the table
-- owner and can block SQL-editor maintenance. postgres and service_role both
-- have BYPASSRLS here.
--
-- Production inventory read 2026-10-17 on tcappmyredeal (alxrmusieuzgssynktxg).
-- Public tables with RLS disabled (7):
--   users, dispatcher_sessions, dispatcher_drafts, scheduled_reminders
--   roa_va_otps, roa_va_users, roa_va_sessions
-- Every other public table already had RLS enabled.
--
-- This migration locks only the MyBiz Line tables below.
-- It does not modify roa_va_otps, roa_va_users, or roa_va_sessions.
-- It does not revoke privileges on the other application's tables. Those
-- include contacts, tasks, reminders, call_notes, and messages. Several of
-- them have anon policies the other app uses. messages and call_notes are
-- that app's tables; this repo also queries them. Changing their policies
-- needs Andre's OK.
--
-- Default privileges and sequence grants are left alone. The same postgres
-- role creates the other application's objects, and a schema-wide revoke
-- would hit its sequences (deal numbers and similar).
--
-- Policies that existed on MyBiz tables at capture:
--   anon_select_otp_codes on otp_codes, FOR SELECT TO anon USING (true)
-- The "owner only sessions" and "owner only drafts" policies from
-- 004a_dispatcher.sql are not in production. They are dropped if present
-- because 004a creates them FOR ALL with no role restriction.
--
-- Run this whole statement once, after a backup. Do not run 000 or 002-008
-- on production.

do $rls$
declare
  mybiz_tables text[] := array[
    'users',
    'otp_codes',
    'biz_contacts',
    'biz_tasks',
    'voicemails',
    'call_recordings',
    'pending_vcards',
    'dispatcher_sessions',
    'dispatcher_drafts',
    'group_threads',
    'group_messages',
    'scheduled_reminders',
    'kb_documents',
    'kb_chunks'
  ];
  table_name text;
begin
  foreach table_name in array mybiz_tables loop
    if table_name like 'roa_va_%' then
      raise exception 'refusing to modify %', table_name;
    end if;
    if to_regclass(format('public.%I', table_name)) is null then
      raise exception 'MyBiz table public.% is missing; refusing to continue', table_name;
    end if;
    execute format('alter table public.%I enable row level security', table_name);
    execute format(
      'revoke all on table public.%I from anon, authenticated, PUBLIC',
      table_name
    );
  end loop;

  execute 'drop policy if exists "owner only sessions" on public.dispatcher_sessions';
  execute 'drop policy if exists "owner only drafts" on public.dispatcher_drafts';
  execute 'drop policy if exists anon_select_otp_codes on public.otp_codes';

  if to_regprocedure('public.match_kb_chunks(public.vector, uuid, integer)') is null then
    raise exception 'public.match_kb_chunks(vector, uuid, integer) is missing; refusing to continue';
  end if;
  execute 'revoke all on function public.match_kb_chunks(public.vector, uuid, integer) from PUBLIC, anon, authenticated';
  execute 'grant execute on function public.match_kb_chunks(public.vector, uuid, integer) to service_role';
end
$rls$;
