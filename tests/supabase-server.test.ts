import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { DbError, getSupabase, resetSupabaseForTests, sb, transactionPoolerOptions } from '../lib/supabase-server';

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) files.push(...walk(path));
    else if (/\.(ts|tsx|js|mjs)$/.test(entry)) files.push(path);
  }
  return files;
}

test('the server client is created once for the same credentials', async () => {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'phase2-service-role';
  resetSupabaseForTests();
  const first = getSupabase();
  const second = getSupabase();
  assert.equal(first, second);
  const again = await import('../lib/supabase-server');
  assert.equal(again.getSupabase(), first);
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'phase2-service-role-other';
  assert.notEqual(getSupabase(), first);
  resetSupabaseForTests();
});

test('a hanging database fetch rejects within 5.5 seconds', async () => {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'phase2-service-role';
  const original = globalThis.fetch;
  globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => new Promise((_resolve, reject) => {
    const signal = init?.signal;
    const fail = () => {
      const error = new Error('timeout');
      error.name = 'TimeoutError';
      reject(error);
    };
    if (signal?.aborted) fail();
    else signal?.addEventListener('abort', fail, { once: true });
  })) as typeof fetch;
  const started = Date.now();
  const keepAlive = setInterval(() => {}, 50);
  try {
    await assert.rejects(sb('/users?select=id&limit=1'), (error: unknown) => {
      assert.ok(error instanceof DbError);
      assert.equal((error as DbError).kind, 'timeout');
      assert.equal((error as Error).message, 'timeout');
      return true;
    });
    assert.ok(Date.now() - started <= 5_500);
  } finally {
    clearInterval(keepAlive);
    globalThis.fetch = original;
  }
});

test('the pooler helper only accepts Supavisor transaction mode', () => {
  const options = transactionPoolerOptions(
    'postgresql://postgres.example:secret@aws-0-us-east-1.pooler.supabase.com:6543/postgres',
  );
  assert.deepEqual(options, { port: '6543', prepare: false, max: 1 });
  assert.throws(() => transactionPoolerOptions('postgresql://postgres.example:secret@db.example.supabase.co:5432/postgres'));
  assert.throws(() => transactionPoolerOptions('postgresql://postgres:secret@aws-0-us-east-1.pooler.supabase.com:6543/postgres'));
  assert.throws(() => transactionPoolerOptions(undefined));
});

test('only the shared server module opens a Supabase client', () => {
  const allowed = join('lib', 'supabase-server.ts');
  const offenders: string[] = [];
  for (const file of [...walk('app'), ...walk('lib')]) {
    const text = readFileSync(file, 'utf8');
    if (text.includes('NEXT_PUBLIC_SUPABASE_URL')) offenders.push(`${file} NEXT_PUBLIC_SUPABASE_URL`);
    if (file === allowed) continue;
    if (text.includes('createClient(')) offenders.push(`${file} createClient`);
    if (text.includes('/rest/v1')) offenders.push(`${file} /rest/v1`);
    if (text.includes("@supabase/supabase-js") || text.includes("from '@supabase/supabase-js'")) {
      offenders.push(`${file} @supabase/supabase-js`);
    }
  }
  assert.deepEqual(offenders, []);
  const cron = readFileSync('app/api/cron/reminders/route.ts', 'utf8');
  assert.equal(cron.includes('.json()'), false);
  const migration = readFileSync('supabase/migrations/011_timeouts_and_indexes.sql', 'utf8');
  const sql = migration.replace(/--.*$/gm, '');
  assert.match(sql, /alter role authenticator set statement_timeout = '8s'/);
  assert.match(sql, /alter role service_role set statement_timeout = '8s'/);
  assert.match(sql, /dispatcher_drafts_pending_created/);
  assert.match(sql, /notify pgrst, 'reload config'/);
  assert.doesNotMatch(sql, /force row level security/i);
  assert.doesNotMatch(sql, /roa_va_/);
});

const databaseUrl = process.env.RLS_TEST_DATABASE_URL;

test('the pending drafts index serves the keyset query', { skip: databaseUrl ? false : 'RLS_TEST_DATABASE_URL is not set' }, () => {
  assert.match(databaseUrl as string, /rls_test/);
  const schema = `phase2_explain_${process.pid}`;
  const sql = `
    create schema ${schema};
    create table ${schema}.dispatcher_drafts (
      id uuid primary key,
      session_id uuid,
      draft_text text not null,
      selected_option text,
      status text default 'pending',
      created_at timestamptz not null default now(),
      from_number text,
      to_number text,
      original_message text,
      action_type text,
      action_meta jsonb
    );
    create index dispatcher_drafts_pending_created
      on ${schema}.dispatcher_drafts (created_at desc)
      where status = 'pending' and from_number is not null;
    insert into ${schema}.dispatcher_drafts (id, draft_text, status, created_at, from_number)
    select gen_random_uuid(), 'draft', 'pending', timestamptz '2026-01-01' + (n || ' seconds')::interval, '+15555550100'
    from generate_series(1, 1000) as n;
  `;
  const explain = `
    set enable_seqscan = off;
    explain (format text)
    select id, from_number, original_message, draft_text, created_at, status
    from ${schema}.dispatcher_drafts
    where status = 'pending' and from_number is not null
    order by created_at desc
    limit 26;
  `;
  try {
    execFileSync('psql', [databaseUrl as string, '-q', '-v', 'ON_ERROR_STOP=1', '-c', sql], { stdio: 'pipe' });
    const plan = execFileSync('psql', [databaseUrl as string, '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-c', explain], { encoding: 'utf8' });
    assert.match(plan, /dispatcher_drafts_pending_created/);
  } finally {
    execFileSync('psql', [databaseUrl as string, '-q', '-c', `drop schema if exists ${schema} cascade`], { stdio: 'pipe' });
  }
});
