import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, test } from 'node:test';

const sessionUserId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const serviceKey = 'admin-portal-test-service-key';
const upstreamLeak = 'upstream-leak-db-error-phone-+15555550123';
const savedEnv = new Map<string, string | undefined>([
  ['SUPABASE_URL', process.env.SUPABASE_URL],
  ['SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY],
  ['SESSION_SECRET', process.env.SESSION_SECRET],
]);

let signSession: (userId: string) => string;
let verifySession: (token: string) => string | null;
let lookupActiveAdmin: (userId: string) => Promise<boolean>;
let isExactActiveAdmin: (rows: unknown) => boolean;
let fetchCalls: string[] = [];
let originalFetch: typeof fetch;

function restoreEnv() {
  savedEnv.forEach((value, name) => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  });
}

function mockLookup(handler: () => Response | Promise<Response>) {
  fetchCalls = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    fetchCalls.push(String(input));
    return handler();
  }) as typeof fetch;
}

before(async () => {
  originalFetch = globalThis.fetch;
  process.env.SESSION_SECRET = 'admin-portal-test-secret';
  ({ signSession, verifySession } = await import('../lib/session'));
  ({ lookupActiveAdmin, isExactActiveAdmin } = await import('../lib/admin-portal-access'));
});

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://supabase.mock.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = serviceKey;
  mockLookup(() => new Response(JSON.stringify([{ is_admin: true, is_active: true }]), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }));
});

after(() => {
  globalThis.fetch = originalFetch;
  restoreEnv();
});

test('exact true and true is the only eligible admin row', async () => {
  assert.equal(await lookupActiveAdmin(sessionUserId), true);
  assert.equal(fetchCalls.length, 1);
  assert.match(fetchCalls[0], new RegExp(`/rest/v1/users\\?id=eq\\.${sessionUserId}&select=is_admin,is_active&limit=1$`));
  assert.equal(fetchCalls[0].includes(serviceKey), false);
  assert.equal(fetchCalls[0].includes('api_key'), false);
  assert.equal(fetchCalls[0].includes('ai_settings'), false);
  assert.equal(isExactActiveAdmin([{ is_admin: true, is_active: true, api_key: serviceKey }]), true);
});

test('missing, false, null, inactive, and malformed rows are not eligible', () => {
  for (const rows of [
    [],
    [{ is_admin: false, is_active: true }],
    [{ is_admin: true, is_active: false }],
    [{ is_admin: null, is_active: true }],
    [{ is_admin: true, is_active: null }],
    [{ is_admin: true }],
    [{ is_admin: 'true', is_active: true }],
    [{ is_admin: true, is_active: 'true' }],
    [{ is_admin: 1, is_active: 1 }],
    [null],
    ['malformed'],
    [[{ is_admin: true, is_active: true }]],
    [{ is_admin: true, is_active: true }, { is_admin: true, is_active: true }],
    null,
    { is_admin: true, is_active: true },
    upstreamLeak,
  ]) {
    assert.equal(isExactActiveAdmin(rows), false);
  }
});

test('missing session, lookup failure, and upstream errors fail closed', async () => {
  const userId = verifySession(signSession(sessionUserId));
  assert.equal(userId, sessionUserId);
  assert.equal(verifySession('not-a-valid-session'), null);
  assert.equal(verifySession(''), null);

  assert.equal(await lookupActiveAdmin(''), false);
  assert.equal(fetchCalls.length, 0);

  delete process.env.SUPABASE_URL;
  fetchCalls = [];
  assert.equal(await lookupActiveAdmin(sessionUserId), false);
  assert.equal(fetchCalls.length, 0);
  process.env.SUPABASE_URL = 'https://supabase.mock.invalid';

  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  fetchCalls = [];
  assert.equal(await lookupActiveAdmin(sessionUserId), false);
  assert.equal(fetchCalls.length, 0);
  process.env.SUPABASE_SERVICE_ROLE_KEY = serviceKey;

  mockLookup(() => { throw new Error(upstreamLeak); });
  assert.equal(await lookupActiveAdmin(sessionUserId), false);

  mockLookup(() => new Response(upstreamLeak, { status: 502 }));
  assert.equal(await lookupActiveAdmin(sessionUserId), false);

  mockLookup(() => new Response('not-json', { status: 200 }));
  assert.equal(await lookupActiveAdmin(sessionUserId), false);

  mockLookup(() => new Response(JSON.stringify({ is_admin: true, is_active: true }), { status: 200 }));
  assert.equal(await lookupActiveAdmin(sessionUserId), false);

  for (const rows of [
    [],
    [{ is_admin: false, is_active: true }],
    [{ is_admin: true, is_active: false }],
    [{ is_admin: null, is_active: true }],
    [{ is_admin: true, is_active: null }],
    [null],
    ['malformed'],
    [[{ is_admin: true, is_active: true }]],
  ]) {
    mockLookup(() => new Response(JSON.stringify(rows), { status: 200 }));
    assert.equal(await lookupActiveAdmin(sessionUserId), false);
    assert.equal(fetchCalls.length, 1);
  }
});

test('admin page renders the existing client only after exact eligibility and otherwise uses notFound', async () => {
  const page = await readFile(new URL('../app/admin/page.tsx', import.meta.url), 'utf8');
  const access = await readFile(new URL('../lib/admin-portal-access.ts', import.meta.url), 'utf8');
  const client = await readFile(new URL('../components/admin/AdminPortalClient.tsx', import.meta.url), 'utf8');
  const middleware = await readFile(new URL('../middleware.ts', import.meta.url), 'utf8');
  const aiSettings = await readFile(new URL('../app/api/admin/ai-settings/route.ts', import.meta.url), 'utf8');

  assert.doesNotMatch(page, /'use client'/);
  assert.match(page, /export const dynamic = 'force-dynamic'/);
  assert.match(page, /export const revalidate = 0/);
  assert.match(page, /export const fetchCache = 'force-no-store'/);
  assert.match(page, /noStore\(\)/);
  assert.match(page, /cookies\(\)\.get\('mbl_session'\)\?\.value/);
  assert.match(page, /verifySession\(token\)/);
  assert.match(page, /lookupActiveAdmin\(userId\)/);
  assert.match(page, /if \(!authorized\) notFound\(\)/);
  assert.match(page, /return <AdminPortalClient \/>/);
  assert.doesNotMatch(page, /<AdminPortalClient [^/>]/);
  assert.doesNotMatch(page, /phone-health|ai-settings|\/api\/admin\/users|api_key|health/);
  assert.match(access, /select=is_admin,is_active&limit=1/);
  assert.match(access, /cache: 'no-store'/);
  assert.match(access, /record\.is_admin === true && record\.is_active === true/);
  assert.doesNotMatch(access, /select=id,name|ai_settings|api_key|phone-health|twilio/i);
  assert.match(client, /<SystemHealthSection \/>/);
  assert.match(client, /data-action="admin-ai-save-settings"/);
  assert.match(client, /fetch\('\/api\/admin\/users', \{ cache: 'no-store' \}\)/);
  assert.equal(middleware.includes('lookupActiveAdmin'), false);
  assert.match(aiSettings, /select=ai_settings/);
  assert.doesNotMatch(aiSettings, /is_admin === true/);
});
