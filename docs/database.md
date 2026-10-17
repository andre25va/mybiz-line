# Database connections

Production project: `tcappmyredeal`. Compute size: Micro (moved up from Nano after the 2026-10-16 outage).

Numbers below are from the Supabase compute guide as of 2026-10-17
(`https://supabase.com/docs/guides/platform/compute-and-disk`). Confirm them in
Dashboard → Settings → Database → Connection pooling before changing anything.
This file does not change production settings.

| Compute | Database max connections | Pooler max clients |
|---|---|---|
| Micro | 60 | 200 |

The Next.js server does not open a Postgres connection. It uses the Data API
(PostgREST) with `SUPABASE_SERVICE_ROLE_KEY`. PostgREST keeps its own pool on
the Supabase side.

Supabase's connection guide says that an app which relies on PostgREST should
not raise the Supavisor pool size past about 40% of the database max
connections. On Micro that is 24. The other connections stay available for
PostgREST, Auth, Storage, Realtime, and the dashboard. Leave the pool size
where it is unless the dashboard shows the pooler is the bottleneck. Do not
set it near 48: that would leave PostgREST only about 20% of the 60 slots.

## Direct Postgres

If a migration script, batch job, or `pg` / `postgres` client is ever added on
Vercel, it must use the Supavisor transaction-mode URL:

- Host: `*.pooler.supabase.com`
- Port: `6543`
- User: `postgres.<project-ref>`
- Env var: `SUPABASE_DB_POOLER_URL` (server-only, never `NEXT_PUBLIC_`)

Transaction mode does not support prepared statements (`prepare: false`),
`SET` outside a transaction, advisory session locks, or `LISTEN` / `NOTIFY`.
Use one connection per serverless instance (`max: 1`) and an idle timeout of
about 10 seconds. Do not use the direct `:5432` host from a Vercel function.
Session mode (port 5432 on the pooler) is only for a long-lived process or a
migration run by hand.

`SUPABASE_DB_POOLER_URL` is not required for this deploy. The running app does
not read it.

## Timeouts

`011_timeouts_and_indexes.sql` sets `statement_timeout` to 8 seconds on
`authenticator` and `service_role`. The app also aborts each Data API request
after 5 seconds. Andre runs that SQL after a backup. It is not applied by the
deploy.
