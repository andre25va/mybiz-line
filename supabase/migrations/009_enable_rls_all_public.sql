-- 009: deny anon and authenticated access to MyBiz Line tables.
-- The server uses service_role, which has BYPASSRLS on this project, so login,
-- contacts, tasks, drafts, the dispatcher, and cron keep working.
-- Do not use FORCE ROW LEVEL SECURITY. That would also apply to the table
-- owner and can block SQL-editor maintenance. postgres and service_role both
-- have BYPASSRLS here.
--
-- Production inventory read 2026-10-17 on tcappmyredeal (alxrmusieuzgssynktxg).
-- Andre confirmed this database is for My Biz Line. This migration locks the
-- MyBiz tables below, including contacts, tasks, messages, call_notes, and
-- reminders. It does not modify roa_va_otps, roa_va_users, or roa_va_sessions.
--
-- Default privileges and sequence grants are left alone. Revoking table
-- privileges already stops anon inserts, including nextval through those
-- inserts. A schema-wide sequence revoke is not required for this lock.
--
-- Policies dropped here are the ones that admit anon: TO anon, or USING (true)
-- / WITH CHECK (true) for PUBLIC. Org and deal SELECT policies stay, and so
-- does contacts_select (auth.uid() IS NOT NULL). They cannot be used after
-- the grants are revoked. Re-granting table privileges would turn them back on.
--
-- task_nudge_status is a security-definer view over tasks. Anon had full
-- grants, so a select on the view bypasses RLS on tasks. My Biz Line does not
-- query the view. This revokes anon, authenticated, and PUBLIC on it when the
-- view exists, and leaves service_role.
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
    'kb_chunks',
    'contacts',
    'tasks',
    'messages',
    'call_notes',
    'reminders'
  ];
  table_name text;
  policy_name text;
  policy_table text;
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

  execute 'drop policy if exists anon_select_contacts on public.contacts';
  execute 'drop policy if exists contacts_insert on public.contacts';
  execute 'drop policy if exists contacts_update on public.contacts';
  execute 'drop policy if exists anon_select_tasks on public.tasks';
  execute 'drop policy if exists tasks_insert on public.tasks';
  execute 'drop policy if exists tasks_update on public.tasks';
  execute 'drop policy if exists anon_select_messages on public.messages';
  execute 'drop policy if exists messages_insert on public.messages';
  execute 'drop policy if exists messages_update on public.messages';
  execute 'drop policy if exists anon_select_call_notes on public.call_notes';
  execute 'drop policy if exists call_notes_insert on public.call_notes';
  execute 'drop policy if exists anon_select_reminders on public.reminders';
  execute 'drop policy if exists reminders_insert on public.reminders';
  execute 'drop policy if exists reminders_update on public.reminders';

  for policy_name, policy_table in
    select p.policyname, p.tablename
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = any(mybiz_tables)
      and (
        'anon' = any(p.roles)
        or btrim(coalesce(p.qual, '')) = 'true'
        or btrim(coalesce(p.with_check, '')) = 'true'
      )
  loop
    if policy_table like 'roa_va_%' then
      raise exception 'refusing to modify %', policy_table;
    end if;
    execute format('drop policy if exists %I on public.%I', policy_name, policy_table);
  end loop;

  if to_regclass('public.task_nudge_status') is not null then
    execute 'revoke all on table public.task_nudge_status from anon, authenticated, PUBLIC';
  end if;

  if to_regprocedure('public.match_kb_chunks(public.vector, uuid, integer)') is null then
    raise exception 'public.match_kb_chunks(vector, uuid, integer) is missing; refusing to continue';
  end if;
  execute 'revoke all on function public.match_kb_chunks(public.vector, uuid, integer) from PUBLIC, anon, authenticated';
  execute 'grant execute on function public.match_kb_chunks(public.vector, uuid, integer) to service_role';
end
$rls$;
