-- 011: statement timeouts and the pending-drafts keyset index.
-- Run this once in the SQL editor after a backup. Do not run it from the app.
-- It does not alter roa_va_* tables.
--
-- PostgREST logs in as authenticator and then SET ROLE. Role parameters apply
-- at login, so authenticator's statement_timeout covers Data API requests,
-- including service_role requests made through PostgREST. The service_role
-- setting covers a session that logs in as service_role directly.
-- Do not FORCE row level security.

alter role authenticator set statement_timeout = '8s';
alter role service_role set statement_timeout = '8s';

create index if not exists dispatcher_drafts_pending_created
  on public.dispatcher_drafts (created_at desc)
  where status = 'pending' and from_number is not null;

notify pgrst, 'reload config';
