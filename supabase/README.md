# Supabase migrations

Production is the Supabase project `tcappmyredeal`. Andre confirmed it is the
My Biz Line database. Nothing in this directory may alter `roa_va_otps`,
`roa_va_users`, or `roa_va_sessions`.

`service_role` on this project has `BYPASSRLS`. The Next.js server uses
`SUPABASE_SERVICE_ROLE_KEY` only. Enabling RLS on MyBiz tables does not change
those server queries.

## What production already has

Captured 2026-10-17 from `pg_catalog`. The historical files below were not a
reliable description of production:

| File | Production |
|---|---|
| `supabase/migration.sql` | `biz_contacts` and `biz_tasks` exist. Later columns are only in `000`. |
| `002_multiunit.sql` | `users` and `otp_codes` exist. Not recorded in `supabase_migrations.schema_migrations`. |
| `003_admin.sql` | `admin_notes` and `last_login` exist. `users_status_idx` does **not**: there is no `users.status` column. |
| `004a_dispatcher.sql` | Tables exist, but not in this shape. Live `dispatcher_drafts` has `draft_text`, `session_id`, `from_number`, `to_number`, `original_message`, `action_type`, `action_meta`. It has no `user_id`, `to_phone`, or `draft` column. RLS was **off**. The "owner only" policies were **not** present. |
| `004b_drafts_columns.sql` | `from_number`, `to_number`, and `original_message` exist. |
| `004c_group_threads.sql` | Tables exist and RLS is on. No policies. |
| `005_reminders.sql` | `scheduled_reminders` exists. RLS was **off**. |
| `006a_drafts_action_type.sql` | Recorded as `schema_migrations` version `20261006133300` (`006_drafts_action_type`). |
| `006b_group_threads_participant_key.sql` | `participant_key` and its index exist. Not recorded under that version name. |
| `007_add_contact_deal_tag.sql` | Recorded as version `20261006174928` (`add_contact_deal_tag`). |
| `008_normalize_confirmed_contacts.sql` | Recorded as version `20261006233355` (`008_normalize_confirmed_contacts`). Data migration; re-running it raises and rolls back. |
| *(not in the repo)* | Version `20261006132129` (`add_ai_settings_to_users`) added `users.ai_settings`. The column is in `000`. |

`000_baseline_prod.sql` is the schema snapshot of the MyBiz tables as of
2026-10-17. It contains no rows.

## What to run

On **production**, after a backup, run only:

`supabase/migrations/009_enable_rls_all_public.sql`

Do not run `000` or `002`–`008` on production. They are already reflected, and
several of them error or describe an older table shape.

On a **new** database, create the Supabase roles `anon`, `authenticated`, and
`service_role`, apply `000`, and create `contacts`, `tasks`, `messages`,
`call_notes`, and `reminders` before `009`. `000` does not create those five
tables. Do not replay `002`–`008` after `000`. `003` indexes `users(status)`,
which does not exist, and `008` throws unless two specific contact rows are
still in their pre-migration form.

## Order from here

Every further schema change is a new file in `supabase/migrations/` with the
next number. Do not edit production in the SQL editor without adding that file
first.

`009` enables RLS and revokes `anon`, `authenticated`, and `PUBLIC` on:

`users`, `otp_codes`, `biz_contacts`, `biz_tasks`, `voicemails`,
`call_recordings`, `pending_vcards`, `dispatcher_sessions`,
`dispatcher_drafts`, `group_threads`, `group_messages`,
`scheduled_reminders`, `kb_documents`, `kb_chunks`, `contacts`, `tasks`,
`messages`, `call_notes`, `reminders`

It drops the policies that admit anon on those tables: `anon_select_otp_codes`,
the `anon_select_*` policies, and the `*_insert` / `*_update` policies whose
check or expression is `true`. It also drops any other policy on this list
that targets `anon` or uses `USING (true)` / `WITH CHECK (true)`. Org and deal
SELECT policies stay, including `contacts_select`. With the grants revoked they
do nothing. It drops the two "owner only" policies if they are present.

`task_nudge_status` is a security-definer view over `tasks`, and anon could
select it. `009` revokes `anon`, `authenticated`, and `PUBLIC` on that view
when it exists. The Next.js app does not query the view.

It revokes `EXECUTE` on `match_kb_chunks(vector, uuid, integer)` from `anon`
and `authenticated` and leaves `EXECUTE` for `service_role`.

It does not `FORCE` RLS, and it does not change default privileges or sequence
grants. A new database must already contain `contacts`, `tasks`, `messages`,
`call_notes`, and `reminders` before `009` runs. `009` raises if any listed
table is missing. `000` does not create those five tables.
