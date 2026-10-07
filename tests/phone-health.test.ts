import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, test } from 'node:test';
import { NextRequest } from 'next/server';

const sessionUserId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const callerUserId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const apiSecret = 'health-test-api-secret';
const authTokenValue = 'health-test-auth-token';
const serviceKey = 'health-test-service-key';
const upstreamLeak = 'upstream-leak-db-error-phone-+15555550123';
const voiceEnvNames = ['TWILIO_ACCOUNT_SID', 'TWILIO_API_KEY', 'TWILIO_API_SECRET', 'TWILIO_TWIML_APP_SID', 'TWILIO_AUTH_TOKEN'] as const;
const savedEnv = new Map<string, string | undefined>([
  ...voiceEnvNames.map(name => [name, process.env[name]] as const),
  ['SUPABASE_URL', process.env.SUPABASE_URL],
  ['SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY],
  ['SESSION_SECRET', process.env.SESSION_SECRET],
]);

const providerOutageDetail =
  'No official provider status source is checked; an integration failure does not establish a provider outage.';

let signSession: (userId: string) => string;
let healthGet: (req: NextRequest) => Promise<Response>;
let healthDynamic: string;
let tokenGet: () => Promise<Response>;
let isVoiceTokenConfigComplete: () => boolean;
let isTwilioAuthTokenPresent: () => boolean;
let fetchCalls: string[] = [];
let originalFetch: typeof fetch;

function setCompleteVoiceEnv() {
  process.env.TWILIO_ACCOUNT_SID = `AC${'1'.repeat(32)}`;
  process.env.TWILIO_API_KEY = `SK${'2'.repeat(32)}`;
  process.env.TWILIO_API_SECRET = apiSecret;
  process.env.TWILIO_TWIML_APP_SID = `AP${'3'.repeat(32)}`;
  process.env.TWILIO_AUTH_TOKEN = authTokenValue;
}

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

function adminRow(row: unknown) {
  mockLookup(() => new Response(JSON.stringify(row), { status: 200, headers: { 'Content-Type': 'application/json' } }));
}

function healthRequest(userId?: string) {
  const headers = new Headers({ 'x-user-id': callerUserId });
  if (userId) headers.set('cookie', `mbl_session=${signSession(userId)}`);
  return new NextRequest(
    `http://localhost/api/admin/phone-health?userId=${callerUserId}&tenantId=${callerUserId}`,
    { headers },
  );
}

function assertNoStore(response: Response) {
  assert.match(response.headers.get('cache-control') || '', /no-store/i);
  assert.match(response.headers.get('cdn-cache-control') || '', /no-store/i);
  assert.match(response.headers.get('vercel-cdn-cache-control') || '', /no-store/i);
  assert.equal(response.headers.get('pragma'), 'no-cache');
  assert.equal(response.headers.get('expires'), '0');
}

async function readJson(response: Response) {
  const text = await response.text();
  assert.equal(text.includes(apiSecret), false);
  assert.equal(text.includes(authTokenValue), false);
  assert.equal(text.includes(serviceKey), false);
  assert.equal(text.includes(upstreamLeak), false);
  return { text, body: JSON.parse(text) as Record<string, unknown> };
}

function assertErrorOnly(body: Record<string, unknown>, error: string) {
  assert.deepEqual(Object.keys(body), ['error']);
  assert.equal(body.error, error);
  assert.equal(body.configuration, undefined);
  assert.equal(body.checks, undefined);
  assert.equal(body.authTokenPresent, undefined);
}

before(async () => {
  process.env.SESSION_SECRET = 'phone-health-test-secret';
  process.env.SUPABASE_URL = 'https://supabase.mock.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = serviceKey;
  setCompleteVoiceEnv();
  ({ signSession } = await import('../lib/session'));
  ({ GET: healthGet, dynamic: healthDynamic } = await import('../app/api/admin/phone-health/route'));
  ({ GET: tokenGet } = await import('../app/api/token/route'));
  ({ isVoiceTokenConfigComplete, isTwilioAuthTokenPresent } = await import('../lib/twilio/config'));
});

beforeEach(() => {
  setCompleteVoiceEnv();
  process.env.SUPABASE_URL = 'https://supabase.mock.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = serviceKey;
  adminRow([{ is_admin: true, is_active: true }]);
});

after(() => {
  globalThis.fetch = originalFetch;
  restoreEnv();
});

before(() => {
  originalFetch = globalThis.fetch;
});

test('voice config uses current truthiness, including whitespace, and token issuance stays the same', async () => {
  assert.equal(isVoiceTokenConfigComplete(), true);
  process.env.TWILIO_ACCOUNT_SID = '   ';
  assert.equal(isVoiceTokenConfigComplete(), true);
  const whitespaceResponse = await tokenGet();
  assert.notEqual(whitespaceResponse.status, 503);
  const whitespaceBody = await readJson(whitespaceResponse);
  assert.equal(whitespaceBody.text.includes(apiSecret), false);

  process.env.TWILIO_API_SECRET = '';
  assert.equal(isVoiceTokenConfigComplete(), false);
  const missing = await tokenGet();
  assert.equal(missing.status, 503);
  assertNoStore(missing);
  const missingBody = await readJson(missing);
  assert.equal(missingBody.body.error, 'Phone token service is unavailable.');

  delete process.env.TWILIO_API_KEY;
  assert.equal(isVoiceTokenConfigComplete(), false);

  setCompleteVoiceEnv();
  const issued = await tokenGet();
  assert.equal(issued.status, 200);
  assertNoStore(issued);
  const issuedBody = await readJson(issued);
  assert.equal(typeof issuedBody.body.token, 'string');
  const token = issuedBody.body.token as string;
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  assert.equal(payload.grants.identity, 'andre');
  assert.equal(payload.grants.voice.incoming.allow, true);
  assert.equal(payload.grants.voice.outgoing.application_sid, process.env.TWILIO_TWIML_APP_SID);
  assert.ok(Math.abs((payload.exp - (payload.iat ?? payload.nbf)) - 3600) < 5);
  assert.ok(Date.parse(String(issuedBody.body.expiresAt)) > Date.now() + 50 * 60 * 1000);
});

test('missing or bad session is a generic 401 with no lookup and no health payload', async () => {
  const missing = await healthGet(healthRequest());
  assert.equal(missing.status, 401);
  assertNoStore(missing);
  assertErrorOnly((await readJson(missing)).body, 'Unauthorized');
  assert.equal(fetchCalls.length, 0);

  fetchCalls = [];
  const bad = await healthGet(new NextRequest('http://localhost/api/admin/phone-health', {
    headers: { cookie: 'mbl_session=not-a-valid-session' },
  }));
  assert.equal(bad.status, 401);
  assertErrorOnly((await readJson(bad)).body, 'Unauthorized');
  assert.equal(fetchCalls.length, 0);
});

test('false, null, missing, and inactive admin rows are a generic 403', async () => {
  for (const row of [
    [{ is_admin: false, is_active: true }],
    [{ is_admin: true, is_active: false }],
    [{ is_admin: null, is_active: true }],
    [{ is_admin: true, is_active: null }],
    [{ is_admin: true }],
    [],
  ]) {
    adminRow(row);
    const response = await healthGet(healthRequest(sessionUserId));
    assert.equal(response.status, 403);
    assertNoStore(response);
    assertErrorOnly((await readJson(response)).body, 'Forbidden');
    assert.equal(fetchCalls.length, 1);
  }
});

test('unexpected lookup network, upstream, and malformed responses are a generic 503', async () => {
  mockLookup(() => { throw new Error(upstreamLeak); });
  const thrown = await healthGet(healthRequest(sessionUserId));
  assert.equal(thrown.status, 503);
  assertNoStore(thrown);
  assertErrorOnly((await readJson(thrown)).body, 'System health is unavailable.');

  mockLookup(() => new Response(upstreamLeak, { status: 502 }));
  const upstream = await healthGet(healthRequest(sessionUserId));
  assert.equal(upstream.status, 503);
  assertErrorOnly((await readJson(upstream)).body, 'System health is unavailable.');

  mockLookup(() => new Response('not-json', { status: 200 }));
  const malformed = await healthGet(healthRequest(sessionUserId));
  assert.equal(malformed.status, 503);
  assertErrorOnly((await readJson(malformed)).body, 'System health is unavailable.');

  mockLookup(() => new Response(JSON.stringify({ is_admin: true, is_active: true }), { status: 200 }));
  const notArray = await healthGet(healthRequest(sessionUserId));
  assert.equal(notArray.status, 503);
  assertErrorOnly((await readJson(notArray)).body, 'System health is unavailable.');

  delete process.env.SUPABASE_URL;
  fetchCalls = [];
  const unconfigured = await healthGet(healthRequest(sessionUserId));
  assert.equal(unconfigured.status, 503);
  assertErrorOnly((await readJson(unconfigured)).body, 'System health is unavailable.');
  assert.equal(fetchCalls.length, 0);
});

test('lookup uses only the session user id and ignores caller-supplied ids', async () => {
  const response = await healthGet(healthRequest(sessionUserId));
  assert.equal(response.status, 200);
  assert.equal(fetchCalls.length, 1);
  assert.match(fetchCalls[0], new RegExp(`/rest/v1/users\\?id=eq\\.${sessionUserId}&select=is_admin,is_active&limit=1$`));
  assert.equal(fetchCalls[0].includes(callerUserId), false);
  assert.equal(fetchCalls[0].includes('api.twilio.com'), false);
  assert.equal(fetchCalls[0].includes('/api/token'), false);
  assert.equal(fetchCalls[0].includes('/Calls'), false);
  assert.equal(fetchCalls[0].includes('Messages'), false);
});

test('health success is presence-only and keeps operational checks unknown', async () => {
  assert.equal(healthDynamic, 'force-dynamic');
  process.env.TWILIO_AUTH_TOKEN = '   ';
  assert.equal(isTwilioAuthTokenPresent(), true);
  let response = await healthGet(healthRequest(sessionUserId));
  assert.equal(response.status, 200);
  assertNoStore(response);
  let { body, text } = await readJson(response);
  assert.equal(body.configuration, 'complete');
  assert.equal(JSON.stringify(body).includes('"healthy"'), false);
  assert.equal(typeof body.configurationObservedAt, 'string');
  assert.ok(Number.isFinite(Date.parse(String(body.configurationObservedAt))));
  assert.equal(body.authTokenPresent, true);
  assert.equal(text.toLowerCase().includes('verified'), false);
  assert.equal(text.includes(`AC${'1'.repeat(32)}`), false);
  assert.equal(text.includes(`SK${'2'.repeat(32)}`), false);
  assert.equal(text.includes(`AP${'3'.repeat(32)}`), false);

  const checks = body.checks as Record<string, { status: string; observedAt: unknown; ref: unknown; detail: string }>;
  for (const name of ['tokenIssuance', 'signatureVerification', 'registration', 'lastCall', 'providerError', 'providerOutage', 'twoWayAudio']) {
    assert.equal(checks[name].status, 'unknown');
    assert.equal(checks[name].observedAt, null);
    assert.equal(checks[name].ref, null);
  }
  assert.equal(checks.providerOutage.detail, providerOutageDetail);
  assert.equal(checks.registration.detail.includes('Not observable'), true);

  delete process.env.TWILIO_AUTH_TOKEN;
  assert.equal(isTwilioAuthTokenPresent(), false);
  process.env.TWILIO_ACCOUNT_SID = '';
  response = await healthGet(healthRequest(sessionUserId));
  ({ body, text } = await readJson(response));
  assert.equal(body.configuration, 'incomplete');
  assert.equal(body.authTokenPresent, false);
  assert.equal((body.checks as { tokenIssuance: { status: string } }).tokenIssuance.status, 'unknown');
  assert.equal(text.includes('TWILIO_'), false);
});

test('admin and phone surfaces do not persist health or invent registration', async () => {
  const appShell = await readFile(new URL('../components/AppShell.tsx', import.meta.url), 'utf8');
  const adminPage = await readFile(new URL('../app/admin/page.tsx', import.meta.url), 'utf8');
  const section = await readFile(new URL('../components/admin/SystemHealthSection.tsx', import.meta.url), 'utf8');
  const healthSource = await readFile(new URL('../app/api/admin/phone-health/route.ts', import.meta.url), 'utf8');
  const tokenSource = await readFile(new URL('../app/api/token/route.ts', import.meta.url), 'utf8');

  const linkEffect = appShell.match(/fetch\('\/api\/admin\/phone-health', \{ cache: 'no-store' \}\)[\s\S]*?\}, \[\]\);/);
  assert.ok(linkEffect);
  assert.match(linkEffect[0], /response\.status === 200/);
  assert.doesNotMatch(linkEffect[0], /localStorage|sessionStorage|\.json\(|setInterval/);
  assert.match(appShell, /activationState === 'ready' && <span className="text-xs text-gray-700 mr-1">Registered<\/span>/);
  assert.match(appShell, /Last call: Unknown/);
  assert.match(appShell, /href="\/admin#system-health"/);
  assert.match(appShell, /data-action="admin-view-phone-health"/);
  assert.match(appShell, /\{showHealthLink && \(/);
  assert.equal((appShell.match(/useTwilioDevice\(/g) || []).length, 1);
  assert.equal((appShell.match(/data-action="activate-phone"/g) || []).length, 2);
  assert.match(appShell, /System Diagnostics/);
  assert.doesNotMatch(appShell, /lib\/twilio\/config/);

  assert.match(adminPage, /<SystemHealthSection \/>/);
  assert.doesNotMatch(adminPage, /admin-tab-health/);
  assert.match(section, /id="system-health"/);
  assert.match(section, /data-action="admin-open-system-health"/);
  assert.match(section, /if \(!health\) return null/);
  assert.match(section, /Unknown/);
  assert.doesNotMatch(section, /localStorage|useTwilioDevice|lib\/twilio\/config|setInterval/);

  assert.match(healthSource, new RegExp(providerOutageDetail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(healthSource, /from 'twilio'|api\/token\/route|calls\/history|readVoiceTokenCredentials/);
  assert.match(tokenSource, /readVoiceTokenCredentials/);
  assert.match(tokenSource, /identity: 'andre'/);
  assert.match(tokenSource, /ttl: TOKEN_TTL_SECONDS/);
  assert.match(tokenSource, /new VoiceGrant\(\{ outgoingApplicationSid: twimlAppSid, incomingAllow: true \}\)/);
});
