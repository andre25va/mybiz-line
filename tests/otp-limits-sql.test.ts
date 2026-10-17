import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { after, test } from 'node:test';

const migration = readFileSync('supabase/migrations/012_otp_limits.sql', 'utf8');

function stripSqlComments(sql: string) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '');
}

test('012 locks the new OTP objects down and leaves other apps alone', () => {
  const sql = stripSqlComments(migration);
  assert.doesNotMatch(sql, /roa_va/);
  assert.doesNotMatch(sql, /force row level security/i);
  assert.match(sql, /alter table public\.otp_codes alter column code drop not null/);
  assert.match(sql, /security definer/);
  assert.match(sql, /set search_path = public/);
  assert.match(sql, /revoke all on function public\.otp_try_send\(text, text\) from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.otp_try_send\(text, text\) to service_role/);
  assert.match(sql, /revoke all on function public\.otp_verify\(text, text\) from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.otp_verify\(text, text\) to service_role/);
  assert.match(sql, /notify pgrst, 'reload schema'/);
});

const dbName = `otp_limits_${process.pid}`;
const psqlEnv = { ...process.env, PGOPTIONS: '-c client_min_messages=warning' };

function canCreateDatabase() {
  try {
    execFileSync('dropdb', ['--if-exists', dbName], { stdio: 'pipe' });
    execFileSync('createdb', [dbName], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

const databaseReady = canCreateDatabase();
const skipReason = databaseReady ? false : 'createdb is not available';

function psql(sql: string) {
  return execFileSync('psql', [
    dbName, '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A', '-c', sql,
  ], { encoding: 'utf8', env: psqlEnv, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function psqlFile(path: string) {
  execFileSync('psql', [
    dbName, '-v', 'ON_ERROR_STOP=1', '-q', '-f', path,
  ], { stdio: 'pipe', env: psqlEnv });
}

function psqlAsync(sql: string) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn('psql', [
      dbName, '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A', '-c', sql,
    ], { env: psqlEnv });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { err += chunk; });
    child.on('close', (code) => {
      if (code === 0) resolve(out.trim());
      else reject(new Error(err || out));
    });
  });
}

after(() => {
  if (!databaseReady) return;
  try {
    execFileSync('dropdb', ['--if-exists', dbName], { stdio: 'pipe' });
  } catch {
    // The proof database is local and disposable.
  }
});

test('otp send and verify limits hold in a throwaway database', { skip: skipReason }, async () => {
  assert.equal(dbName.includes('rls_test'), false);
  psql(`
    create extension if not exists pgcrypto;
    create table public.otp_codes (
      id uuid primary key default gen_random_uuid(),
      phone text not null,
      code text not null,
      expires_at timestamptz not null,
      used boolean not null default false,
      attempts integer not null default 0,
      created_at timestamptz default now()
    );
  `);
  for (const role of ['anon', 'authenticated', 'service_role']) {
    try {
      psql(`create role ${role} nologin`);
    } catch (error) {
      if (!String(error).includes('already exists')) throw error;
    }
  }
  psql('grant usage on schema public to anon, authenticated, service_role');
  psqlFile('supabase/migrations/012_otp_limits.sql');

  const phone = '+13125550600';
  for (let n = 0; n < 3; n += 1) {
    assert.equal(psql(`select public.otp_try_send('${phone}', '198.51.100.${n}')`), 'ok');
  }
  assert.equal(psql(`select public.otp_try_send('${phone}', '198.51.100.9')`), 'phone_limited');

  const ip = '198.51.100.77';
  for (let n = 0; n < 10; n += 1) {
    const other = `+13125558${String(n).padStart(3, '0')}`;
    assert.equal(psql(`select public.otp_try_send('${other}', '${ip}')`), 'ok');
  }
  assert.equal(psql(`select public.otp_try_send('+13125558999', '${ip}')`), 'ip_limited');

  const aged = '+13125550400';
  for (let n = 0; n < 3; n += 1) {
    assert.equal(psql(`select public.otp_try_send('${aged}', '192.0.2.${n}')`), 'ok');
  }
  assert.equal(psql(`select public.otp_try_send('${aged}', '192.0.2.9')`), 'phone_limited');
  psql(`update public.otp_send_log set created_at = now() - interval '601 seconds' where phone = '${aged}'`);
  assert.equal(psql(`select public.otp_try_send('${aged}', '192.0.2.10')`), 'ok');

  psql(`update public.auth_settings set value = 1 where key = 'otp_send_per_phone_max'`);
  assert.equal(psql(`select public.otp_try_send('+13125550500', '203.0.113.10')`), 'ok');
  assert.equal(psql(`select public.otp_try_send('+13125550500', '203.0.113.11')`), 'phone_limited');
  psql(`update public.auth_settings set value = 5 where key = 'otp_send_per_phone_max'`);
  assert.equal(psql(`select public.otp_try_send('+13125550500', '203.0.113.12')`), 'ok');
  psql(`update public.auth_settings set value = 3 where key = 'otp_send_per_phone_max'`);

  const correct = 'a'.repeat(64);
  const wrong = 'b'.repeat(64);
  psql(`
    insert into public.otp_codes(phone, code, code_hash, expires_at)
    values ('+13125550300', null, '${correct}', now() + interval '10 minutes');
  `);
  for (let n = 0; n < 4; n += 1) {
    assert.equal(psql(`select public.otp_verify('+13125550300', '${wrong}')`), 'invalid');
  }
  assert.equal(psql(`select public.otp_verify('+13125550300', '${wrong}')`), 'locked');
  assert.equal(psql(`select public.otp_verify('+13125550300', '${correct}')`), 'locked');
  const burned = psql(`select used::text || ',' || attempts from public.otp_codes where phone = '+13125550300'`);
  assert.equal(burned, 'true,5');

  psql(`
    insert into public.otp_codes(phone, code, code_hash, expires_at)
    values ('+13125550301', null, '${correct}', now() + interval '10 minutes');
  `);
  for (let n = 0; n < 4; n += 1) {
    assert.equal(psql(`select public.otp_verify('+13125550301', '${wrong}')`), 'invalid');
  }
  assert.equal(psql(`select public.otp_verify('+13125550301', '${correct}')`), 'ok');
  assert.equal(psql(`select public.otp_verify('+13125550301', '${correct}')`), 'invalid');

  psql(`
    insert into public.otp_codes(phone, code, code_hash, expires_at)
    values ('+13125550700', null, '${correct}', now() + interval '10 minutes');
  `);
  const raced = (await Promise.all([
    psqlAsync(`select public.otp_verify('+13125550700', '${correct}')`),
    psqlAsync(`select public.otp_verify('+13125550700', '${correct}')`),
  ])).sort();
  assert.deepEqual(raced, ['invalid', 'ok']);

  assert.throws(
    () => psql(`begin; set local role anon; select public.otp_try_send('+13120000000', '127.0.0.1'); commit;`),
    /permission denied/,
  );
  assert.throws(
    () => psql('begin; set local role anon; select count(*) from public.otp_send_log; commit;'),
    /permission denied/,
  );
  assert.equal(
    psql(`begin; set local role service_role; select public.otp_try_send('+13125550991', '192.0.2.40'); commit;`),
    'ok',
  );
});
