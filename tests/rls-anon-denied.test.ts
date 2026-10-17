import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const migrationSql = readFileSync(
  'supabase/migrations/009_enable_rls_all_public.sql',
  'utf8',
);
const baselineSql = readFileSync(
  'supabase/migrations/000_baseline_prod.sql',
  'utf8',
);

const lockedTables = [
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
  'reminders',
];

const droppedPolicies = [
  'anon_select_otp_codes on public.otp_codes',
  'anon_select_contacts on public.contacts',
  'contacts_insert on public.contacts',
  'contacts_update on public.contacts',
  'anon_select_tasks on public.tasks',
  'tasks_insert on public.tasks',
  'tasks_update on public.tasks',
  'anon_select_messages on public.messages',
  'messages_insert on public.messages',
  'messages_update on public.messages',
  'anon_select_call_notes on public.call_notes',
  'call_notes_insert on public.call_notes',
  'anon_select_reminders on public.reminders',
  'reminders_insert on public.reminders',
  'reminders_update on public.reminders',
];

function stripSqlComments(sql: string) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--.*$/gm, '');
}

function assertDeniedRead(status: number, body: string) {
  if (status === 401 || status === 403) return;
  assert.equal(status, 200, `anon read returned status ${status}`);
  const parsed: unknown = JSON.parse(body);
  assert.ok(Array.isArray(parsed), `anon read returned status ${status}`);
  assert.equal(parsed.length, 0, `anon read returned ${parsed.length} row(s)`);
}

const supabaseUrl = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const liveSkip = supabaseUrl && anonKey
  ? false
  : 'SUPABASE_URL and SUPABASE_ANON_KEY are not set';

async function anonRequest(path: string, init?: RequestInit) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: anonKey as string,
      Authorization: `Bearer ${anonKey}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  return { status: response.status, body: await response.text() };
}

test('009 locks only MyBiz tables and does not force RLS', () => {
  const executable = stripSqlComments(migrationSql);
  assert.equal(/alter\s+table\s+[^;]*roa_va_/i.test(executable), false);
  for (const statement of executable.match(/drop\s+policy[^;]*/gi) || []) {
    assert.equal(/roa_va_/i.test(statement), false, statement);
  }
  assert.match(executable, /table_name like 'roa_va_%'/);
  assert.equal(/force\s+row\s+level\s+security/i.test(executable), false);
  assert.equal(/revoke\s+all\s+on\s+all\s+sequences/i.test(executable), false);
  assert.equal(/alter\s+default\s+privileges/i.test(executable), false);
  for (const statement of executable.match(/revoke[^;]*/gi) || []) {
    assert.equal(/service_role/i.test(statement), false, statement);
  }
  for (const policy of droppedPolicies) {
    assert.match(executable, new RegExp(`drop policy if exists ${policy}`, 'i'));
  }
  assert.match(executable, /drop policy if exists "owner only sessions" on public\.dispatcher_sessions/i);
  assert.match(executable, /drop policy if exists "owner only drafts" on public\.dispatcher_drafts/i);
  assert.match(executable, /'anon' = any\(p\.roles\)/);
  assert.match(executable, /revoke all on table public\.task_nudge_status from anon, authenticated, PUBLIC/i);
  assert.match(executable, /grant execute on function public\.match_kb_chunks\(public\.vector, uuid, integer\) to service_role/i);
  for (const kept of ['contacts_select', 'tasks_select', 'messages_select', 'call_notes_select', 'reminders_select']) {
    assert.equal(
      new RegExp(`drop policy if exists ${kept}`, 'i').test(executable),
      false,
      `${kept} is not an anon-open policy and must stay`,
    );
  }

  const listed = executable.match(/mybiz_tables text\[\] := array\[([\s\S]*?)\]/);
  assert.ok(listed, 'expected an explicit mybiz_tables array');
  const names = [...listed[1].matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
  assert.deepEqual(names, lockedTables);
  assert.equal(names.includes('deals'), false);
  assert.equal(names.some((name) => name.startsWith('roa_va_')), false);
});

test('000 records the production MyBiz shape without copying rows', () => {
  const executable = stripSqlComments(baselineSql);
  assert.match(baselineSql, /2026-10-17/);
  assert.match(baselineSql, /tcappmyredeal/);
  assert.equal(/insert\s+into/i.test(executable), false);
  assert.match(executable, /ai_settings jsonb/);
  assert.match(executable, /draft_text text not null/);
  assert.match(executable, /attempts integer not null default 0/);
  assert.match(executable, /deal_tag text/);
  assert.match(executable, /participant_key text/);
  assert.match(executable, /create policy anon_select_otp_codes/i);
  assert.equal(executable.includes('roa_va_'), false);
});

test('anon cannot read users', { skip: liveSkip }, async () => {
  const { status, body } = await anonRequest('users?select=*&limit=1');
  assertDeniedRead(status, body);
});

test('anon cannot read otp_codes', { skip: liveSkip }, async () => {
  const { status, body } = await anonRequest('otp_codes?select=*&limit=1');
  assertDeniedRead(status, body);
});

test('anon cannot insert otp_codes', { skip: liveSkip }, async () => {
  const { status } = await anonRequest('otp_codes', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      phone: '+15555550100',
      code: '000000',
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    }),
  });
  assert.ok(status === 401 || status === 403, `anon insert was not denied (status ${status})`);
});

const rlsTestDatabaseUrl = process.env.RLS_TEST_DATABASE_URL;
const localSkip = rlsTestDatabaseUrl
  ? false
  : 'RLS_TEST_DATABASE_URL is not set';

const psqlEnv = {
  ...process.env,
  PGOPTIONS: '-c client_min_messages=warning',
};

function psql(sql: string) {
  return execFileSync('psql', [
    rlsTestDatabaseUrl as string,
    '-v', 'ON_ERROR_STOP=1',
    '-q', '-t', '-A',
    '-c', sql,
  ], { encoding: 'utf8', env: psqlEnv });
}

function psqlFile(path: string) {
  execFileSync('psql', [
    rlsTestDatabaseUrl as string,
    '-v', 'ON_ERROR_STOP=1',
    '-q',
    '-f', path,
  ], { encoding: 'utf8', env: psqlEnv });
}

function scalar(sql: string) {
  const line = psql(sql)
    .split('\n')
    .map((row) => row.trim())
    .find((row) => /^\d+(,\d+)*$/.test(row));
  assert.ok(line, 'expected a numeric psql result');
  return line;
}

test('009 denies anon on a database loaded from the baseline', { skip: localSkip }, () => {
  assert.match(
    rlsTestDatabaseUrl as string,
    /rls_test/,
    'refusing to run the local RLS proof against a database whose name does not contain rls_test',
  );
  psql(`
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then
        create role anon nologin;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then
        create role authenticated nologin;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then
        create role service_role nologin bypassrls;
      end if;
    end $$;
    alter role service_role bypassrls;
    drop schema if exists public cascade;
    create schema public;
    grant usage on schema public to anon, authenticated, service_role;
  `);
  psqlFile('supabase/migrations/000_baseline_prod.sql');
  psql(`
    insert into public.users(phone, name) values ('+15555550100', 'rls-test');
    insert into public.otp_codes(phone, code, expires_at)
      values ('+15555550100', '000000', now() + interval '1 minute');

    create table public.contacts (id integer primary key);
    create table public.tasks (id integer primary key);
    create table public.messages (id integer primary key);
    create table public.call_notes (id integer primary key);
    create table public.reminders (id integer primary key);
    create table public.roa_va_otps (id integer primary key);
    insert into public.contacts(id) values (1);
    insert into public.tasks(id) values (1);
    insert into public.messages(id) values (1);
    insert into public.call_notes(id) values (1);
    insert into public.reminders(id) values (1);
    grant all on public.contacts, public.tasks, public.messages, public.call_notes, public.reminders to anon, authenticated, service_role;
    grant select on public.roa_va_otps to anon;
    create policy anon_select_contacts on public.contacts for select to anon using (true);
    create policy contacts_insert on public.contacts for insert to public with check (true);
    create policy contacts_select on public.contacts for select to public using (id is not null);
    create policy anon_extra_contacts on public.contacts for select to anon using (id > 0);
    create view public.task_nudge_status as select id from public.tasks;
    grant all on public.task_nudge_status to anon, authenticated, service_role;
  `);
  const before = scalar(`
    begin;
    set local role anon;
    select (select count(*) from public.users)
      || ',' || (select count(*) from public.otp_codes)
      || ',' || (select count(*) from public.contacts)
      || ',' || (select count(*) from public.task_nudge_status);
    commit;
  `);
  assert.equal(before, '1,1,1,1');

  psqlFile('supabase/migrations/009_enable_rls_all_public.sql');

  assert.throws(
    () => psql(`begin; set local role anon; select count(*) from public.users; commit;`),
    /permission denied for table users/,
  );
  assert.throws(
    () => psql(`begin; set local role anon; select count(*) from public.otp_codes; commit;`),
    /permission denied for table otp_codes/,
  );
  assert.throws(
    () => psql(`
      begin;
      set local role anon;
      insert into public.otp_codes(phone, code, expires_at)
        values ('+15555550101', '000000', now() + interval '1 minute');
      commit;
    `),
    /permission denied for table otp_codes/,
  );
  for (const table of ['contacts', 'tasks', 'messages', 'call_notes', 'reminders']) {
    assert.throws(
      () => psql(`begin; set local role anon; select count(*) from public.${table}; commit;`),
      new RegExp(`permission denied for table ${table}`),
    );
  }
  assert.throws(
    () => psql('begin; set local role anon; select count(*) from public.task_nudge_status; commit;'),
    /permission denied for view task_nudge_status/,
  );
  const roaStillOpen = scalar(`
    begin;
    set local role anon;
    select count(*) from public.roa_va_otps;
    commit;
  `);
  assert.equal(roaStillOpen, '0');
  const after = scalar(`
    begin;
    set local role service_role;
    select (select count(*) from public.users)
      || ',' || (select count(*) from public.otp_codes)
      || ',' || (select count(*) from public.contacts)
      || ',' || (select count(*) from public.tasks)
      || ',' || (select count(*) from public.messages)
      || ',' || (select count(*) from public.call_notes)
      || ',' || (select count(*) from public.reminders)
      || ',' || (select count(*) from public.task_nudge_status);
    commit;
  `);
  assert.equal(after, '1,1,1,1,1,1,1,1');
  const policyCount = scalar(`
    select count(*) from pg_policies
    where schemaname = 'public'
      and policyname in (
        'anon_select_otp_codes',
        'anon_select_contacts',
        'contacts_insert',
        'anon_extra_contacts'
      );
  `);
  assert.equal(policyCount, '0');
  const keptPolicy = scalar(`
    select count(*) from pg_policies
    where schemaname = 'public' and policyname = 'contacts_select';
  `);
  assert.equal(keptPolicy, '1');
  const unlocked = psql(`
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relrowsecurity = false
    order by 1;
  `).trim();
  assert.equal(unlocked, 'roa_va_otps');
  psqlFile('supabase/migrations/009_enable_rls_all_public.sql');
});
