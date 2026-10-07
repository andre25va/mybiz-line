import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, test } from 'node:test';
import { NextRequest } from 'next/server';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseAdminUsers, UsersReadOnlyList, type AdminUserRecord } from '../components/admin/UsersReadOnlyList';
const sessionUserId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const callerUserId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const serviceKey = 'users-test-service-key';
const upstreamLeak = 'upstream-leak-db-error-phone-+15555550123';
const secretApiKey = 'secret-user-api-key-should-not-leak';
const savedEnv = new Map<string, string | undefined>([
  ['SUPABASE_URL', process.env.SUPABASE_URL],
  ['SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY],
  ['SESSION_SECRET', process.env.SESSION_SECRET],
]);
let signSession: (userId: string) => string;
let usersGet: (req: NextRequest) => Promise<Response>;
let fetchCalls: string[] = [];
let originalFetch: typeof fetch;
function restoreEnv() {
  savedEnv.forEach((value, name) => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  });
}
function mockFetch(handler: (url: string) => Response | Promise<Response>) {
  fetchCalls = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    fetchCalls.push(url);
    return handler(url);
  }) as typeof fetch;
}
function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
function usersRequest(userId?: string) {
  const headers = new Headers({ 'x-user-id': callerUserId });
  if (userId) headers.set('cookie', `mbl_session=${signSession(userId)}`);
  return new NextRequest(
    `http://localhost/api/admin/users?userId=${callerUserId}&tenantId=${callerUserId}`,
    { headers },
  );
}
function allowAdminThen(list: unknown) {
  mockFetch(url => {
    if (url.includes('select=is_admin,is_active')) return jsonResponse([{ is_admin: true, is_active: true }]);
    return jsonResponse(list);
  });
}
async function readJson(response: Response) {
  const text = await response.text();
  assert.equal(text.includes(serviceKey), false);
  assert.equal(text.includes(upstreamLeak), false);
  assert.equal(text.includes(secretApiKey), false);
  return { text, body: JSON.parse(text) as Record<string, unknown> };
}
function assertErrorOnly(body: Record<string, unknown>, error: string) {
  assert.deepEqual(Object.keys(body).sort(), ['error']);
  assert.equal(body.error, error);
  assert.equal(body.users, undefined);
}
before(async () => {
  process.env.SESSION_SECRET = 'admin-users-readonly-test-secret';
  process.env.SUPABASE_URL = 'https://supabase.mock.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = serviceKey;
  ({ signSession } = await import('../lib/session'));
  ({ GET: usersGet } = await import('../app/api/admin/users/route'));
});
beforeEach(() => {
  process.env.SUPABASE_URL = 'https://supabase.mock.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = serviceKey;
  allowAdminThen([]);
});
before(() => {
  originalFetch = globalThis.fetch;
});
after(() => {
  globalThis.fetch = originalFetch;
  restoreEnv();
});
test('unauthenticated user list requests do not look up or return users', async () => {
  const missing = await usersGet(usersRequest());
  assert.equal(missing.status, 401);
  assert.match(missing.headers.get('cache-control') || '', /no-store/i);
  assertErrorOnly((await readJson(missing)).body, 'Unauthorized');
  assert.equal(fetchCalls.length, 0);
  fetchCalls = [];
  const bad = await usersGet(new NextRequest('http://localhost/api/admin/users', {
    headers: { cookie: 'mbl_session=not-a-valid-session' },
  }));
  assert.equal(bad.status, 401);
  assert.match(bad.headers.get('cache-control') || '', /no-store/i);
  assertErrorOnly((await readJson(bad)).body, 'Unauthorized');
  assert.equal(fetchCalls.length, 0);
});
test('a valid session that is not an active admin is a generic 403', async () => {
  for (const row of [
    { is_admin: false, is_active: true },
    { is_admin: true, is_active: false },
    { is_admin: null, is_active: true },
    { is_admin: true, is_active: null },
    { is_active: true },
    [],
  ]) {
    mockFetch(() => jsonResponse(Array.isArray(row) ? row : [row]));
    const response = await usersGet(usersRequest(sessionUserId));
    assert.equal(response.status, 403);
    assert.match(response.headers.get('cache-control') || '', /no-store/i);
    assertErrorOnly((await readJson(response)).body, 'Forbidden');
    assert.equal(fetchCalls.length, 1);
    assert.match(fetchCalls[0], new RegExp(`id=eq\\.${sessionUserId}`));
    assert.equal(fetchCalls[0].includes(callerUserId), false);
    assert.equal(fetchCalls[0].includes('email'), false);
    assert.equal(fetchCalls[0].includes('api_key'), false);
  }
});
test('null and malformed admin lookups are a generic unavailable response', async () => {
  for (const row of [null, 'malformed', ['nested']]) {
    mockFetch(() => jsonResponse([row]));
    const response = await usersGet(usersRequest(sessionUserId));
    assert.equal(response.status, 503);
    assertErrorOnly((await readJson(response)).body, 'User list is unavailable.');
    assert.equal(fetchCalls.length, 1);
  }
  mockFetch(() => jsonResponse({ error: upstreamLeak }));
  const objectBody = await usersGet(usersRequest(sessionUserId));
  assert.equal(objectBody.status, 503);
  assertErrorOnly((await readJson(objectBody)).body, 'User list is unavailable.');
});
test('upstream and network failures stay redacted', async () => {
  mockFetch(() => { throw new Error(upstreamLeak); });
  const network = await usersGet(usersRequest(sessionUserId));
  assert.equal(network.status, 503);
  assertErrorOnly((await readJson(network)).body, 'User list is unavailable.');
  mockFetch(() => jsonResponse({ message: upstreamLeak, api_key: secretApiKey }, 502));
  const upstream = await usersGet(usersRequest(sessionUserId));
  assert.equal(upstream.status, 503);
  assertErrorOnly((await readJson(upstream)).body, 'User list is unavailable.');
  delete process.env.SUPABASE_URL;
  fetchCalls = [];
  const missingEnv = await usersGet(usersRequest(sessionUserId));
  assert.equal(missingEnv.status, 503);
  assertErrorOnly((await readJson(missingEnv)).body, 'User list is unavailable.');
  assert.equal(fetchCalls.length, 0);
});
test('a successful list returns only supported fields', async () => {
  allowAdminThen([
    {
      id: 'user-1',
      name: 'Ada',
      phone: '+15555550100',
      email: 'ada@example.invalid',
      role: 'admin',
      status: 'active',
      api_key: secretApiKey,
      is_admin: true,
      is_active: null,
      created_at: '2026-10-07T00:00:00.000Z',
      last_login: null,
      message_count: 4,
    },
    {
      id: 'user-2',
      name: 'Grace',
      phone: '+15555550101',
      is_admin: false,
      is_active: true,
      created_at: null,
      last_login: '2026-10-06T00:00:00.000Z',
    },
  ]);
  const response = await usersGet(usersRequest(sessionUserId));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control') || '', /no-store/i);
  const { body, text } = await readJson(response);
  assert.equal(text.includes('ada@example.invalid'), false);
  assert.equal(text.includes('message_count'), false);
  assert.equal(text.includes('"role"'), false);
  assert.equal(text.includes('"status"'), false);
  const users = body.users as Record<string, unknown>[];
  assert.equal(users.length, 2);
  assert.deepEqual(Object.keys(users[0]).sort(), ['created_at', 'id', 'is_active', 'is_admin', 'last_login', 'name', 'phone']);
  assert.equal(users[0].is_admin, true);
  assert.equal(users[0].is_active, null);
  assert.equal(users[1].is_admin, false);
  assert.equal(users[1].is_active, true);
  assert.equal(fetchCalls.length, 2);
  assert.equal(fetchCalls[1].includes('email'), false);
  assert.equal(fetchCalls[1].includes('api_key'), false);
  assert.equal(fetchCalls[1].includes('role'), false);
  assert.equal(fetchCalls[1].includes('status'), false);
  assert.match(fetchCalls[1], /select=id,name,phone,is_admin,is_active,created_at,last_login/);
});
test('a leaked or malformed list row does not return a partial user payload', async () => {
  allowAdminThen([{ id: 'user-1', name: 'Ada', phone: '+15555550100', api_key: secretApiKey, error: upstreamLeak }]);
  const response = await usersGet(usersRequest(sessionUserId));
  assert.equal(response.status, 503);
  assertErrorOnly((await readJson(response)).body, 'User list is unavailable.');
});
test('the users screen renders supported fields and does not expose writes', async () => {
  const page = await readFile(new URL('../app/admin/page.tsx', import.meta.url), 'utf8');
  const listSource = await readFile(new URL('../components/admin/UsersReadOnlyList.tsx', import.meta.url), 'utf8');
  const route = await readFile(new URL('../app/api/admin/users/route.ts', import.meta.url), 'utf8');
  const usersTab = page.slice(page.indexOf('{/* Users Tab */}'), page.indexOf('{/* AI Provider Tab */}'));
  assert.match(usersTab, /This account list is read-only/);
  assert.match(page, /fetch\('\/api\/admin\/users', \{ cache: 'no-store' \}\)/);
  assert.equal((page.match(/\/api\/admin\/users/g) || []).length, 1);
  assert.doesNotMatch(page, /\/api\/admin\/users'[\s\S]{0,120}method:\s*'POST'/);
  assert.doesNotMatch(page, /\/api\/admin\/users'[\s\S]{0,120}method:\s*'PATCH'/);
  assert.doesNotMatch(`${usersTab}\n${listSource}`, /admin-add-user|admin-confirm-add-user|admin-cancel-add-user|admin-toggle-user-status|admin-copy-api-key|Create Account|Suspend|Activate|api_key|user\.email|user\.role|user\.status|message_count/);
  assert.match(page, /data-action="admin-ai-save-settings"/);
  assert.match(page, /\/api\/admin\/ai-settings/);
  assert.match(route.slice(route.indexOf('export async function POST')), /sendWelcomeSMS/);
  assert.match(route.slice(route.indexOf('export async function PATCH')), /\.update\(\{ status \}\)/);
  const records: AdminUserRecord[] = [
    {
      id: 'user-1',
      name: 'Ada',
      phone: '+15555550100',
      is_admin: true,
      is_active: null,
      created_at: '2026-10-07T00:00:00.000Z',
      last_login: null,
    },
    {
      id: 'user-2',
      name: 'Grace',
      phone: '+15555550101',
      is_admin: false,
      is_active: false,
      created_at: null,
      last_login: '2026-10-06T00:00:00.000Z',
    },
  ];
  assert.deepEqual(parseAdminUsers({ users: records }), records);
  assert.equal(parseAdminUsers({ users: [{ ...records[0], api_key: secretApiKey, email: 'ada@example.invalid' }] }), null);
  const markup = renderToStaticMarkup(createElement(UsersReadOnlyList, { users: records }));
  assert.match(markup, /Ada/);
  assert.match(markup, /\+15555550100/);
  assert.match(markup, />Admin</);
  assert.match(markup, />Unknown</);
  assert.match(markup, />Not admin</);
  assert.match(markup, />Inactive</);
  assert.match(markup, /Last login Unknown/);
  assert.doesNotMatch(markup, /api_key|secret-user-api-key|Suspend|Activate|Create Account|Copy|ada@example\.invalid|Add User/);
});