import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { NextRequest } from 'next/server';
import twilio from 'twilio';

const PEPPER = 'test-only-otp-pepper';
const savedEnv = new Map<string, string | undefined>([
  ['SUPABASE_URL', process.env.SUPABASE_URL],
  ['SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY],
  ['TWILIO_ACCOUNT_SID', process.env.TWILIO_ACCOUNT_SID],
  ['TWILIO_AUTH_TOKEN', process.env.TWILIO_AUTH_TOKEN],
  ['TWILIO_PHONE_NUMBER', process.env.TWILIO_PHONE_NUMBER],
  ['SESSION_SECRET', process.env.SESSION_SECRET],
  ['OTP_PEPPER', process.env.OTP_PEPPER],
]);

let sendOtp: (request: NextRequest) => Promise<Response>;
let verifyOtp: (request: NextRequest) => Promise<Response>;
let originalFetch: typeof fetch;
let fetchCalls: Array<{ url: string; method: string; body?: string }> = [];

function restoreEnv() {
  savedEnv.forEach((value, name) => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  });
}

function sendRequest(phone: string, headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/auth/send-otp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ phone }),
  });
}

function verifyRequest(phone: string, code: string) {
  return new NextRequest('http://localhost/api/auth/verify-otp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone, code }),
  });
}

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  fetchCalls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    fetchCalls.push({
      url: String(input),
      method: init?.method || 'GET',
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
    return handler(String(input), init);
  }) as typeof fetch;
}

function hash(phone: string, code: string) {
  return createHmac('sha256', PEPPER).update(`${phone}:${code}`).digest('hex');
}

before(async () => {
  process.env.SUPABASE_URL = 'https://supabase.mock.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-service-role-key';
  process.env.TWILIO_ACCOUNT_SID = `AC${'a'.repeat(32)}`;
  process.env.TWILIO_AUTH_TOKEN = 'test-only-auth-token';
  process.env.TWILIO_PHONE_NUMBER = '+15555550100';
  process.env.SESSION_SECRET = 'test-only-session-secret';
  process.env.OTP_PEPPER = PEPPER;
  ({ POST: sendOtp } = await import('../app/api/auth/send-otp/route'));
  ({ POST: verifyOtp } = await import('../app/api/auth/verify-otp/route'));
  originalFetch = globalThis.fetch;
});

after(() => {
  globalThis.fetch = originalFetch;
  restoreEnv();
});

test('an invalid phone is rejected before any database or rate-limit call', async () => {
  let fetches = 0;
  globalThis.fetch = (async () => {
    fetches += 1;
    throw new Error('unexpected fetch');
  }) as typeof fetch;
  for (const phone of ['12345', '0129989898', '123456789012', '+44 20 7946 0958']) {
    const response = await sendOtp(sendRequest(phone));
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'Enter a valid 10-digit US phone number' });
    const verify = await verifyOtp(verifyRequest(phone, '123456'));
    assert.equal(verify.status, 400);
    assert.deepEqual(await verify.json(), { error: 'Enter a valid 10-digit US phone number' });
  }
  const empty = await verifyOtp(verifyRequest('', '123456'));
  assert.equal(empty.status, 400);
  assert.equal(fetches, 0);
});

test('a phone limit returns 429 with Retry-After and does not text', async () => {
  mockFetch((url) => {
    if (url.includes('/users?')) return new Response('[{"id":"user-test"}]', { status: 200 });
    if (url.includes('/rpc/otp_try_send')) return new Response(JSON.stringify('phone_limited'), { status: 200 });
    if (url.includes('otp_send_per_phone_window_sec')) return new Response('[{"value":120}]', { status: 200 });
    throw new Error(`unexpected ${url}`);
  });
  const prototype = (twilio as any).RequestClient.prototype;
  const originalRequest = prototype.request;
  let twilioCalls = 0;
  prototype.request = async () => {
    twilioCalls += 1;
    throw new Error('sms should not be sent');
  };
  const originalError = console.error;
  const logs: string[] = [];
  console.error = (...args: unknown[]) => logs.push(args.map(String).join(' '));
  try {
    const response = await sendOtp(sendRequest('3125550100', { 'x-forwarded-for': '203.0.113.9, 10.0.0.8' }));
    assert.equal(response.status, 429);
    assert.equal(response.headers.get('retry-after'), '120');
    assert.deepEqual(await response.json(), { error: 'Too many code requests. Wait a few minutes and try again.' });
    assert.equal(twilioCalls, 0);
    assert.deepEqual(fetchCalls.map((call) => call.method), ['GET', 'POST', 'GET']);
    const rpc = JSON.parse(fetchCalls[1].body || '{}');
    assert.deepEqual(rpc, { p_phone: '+13125550100', p_ip: '203.0.113.9' });
    assert.equal(logs.length, 1);
    assert.equal(JSON.parse(logs[0]).phase, 'rate_limit');
    assert.equal(logs[0].includes('3125550100'), false);
  } finally {
    prototype.request = originalRequest;
    console.error = originalError;
  }
});

test('an IP limit uses the IP window and the first forwarded address', async () => {
  mockFetch((url) => {
    if (url.includes('/users?')) return new Response('[]', { status: 200 });
    if (url.includes('/rpc/otp_try_send')) return new Response(JSON.stringify('ip_limited'), { status: 200 });
    if (url.includes('otp_send_per_ip_window_sec')) return new Response('[{"value":90}]', { status: 200 });
    throw new Error(`unexpected ${url}`);
  });
  const response = await sendOtp(sendRequest('3125550100', { 'x-forwarded-for': '198.51.100.4, 10.1.1.1' }));
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '90');
  assert.equal((await response.json()).error.includes('not registered'), false);
  const rpc = JSON.parse(fetchCalls[1].body || '{}');
  assert.equal(rpc.p_ip, '198.51.100.4');
});

test('a missing forwarded header falls back to x-real-ip and then unknown', async () => {
  mockFetch((url) => {
    if (url.includes('/users?')) return new Response('[]', { status: 200 });
    if (url.includes('/rpc/otp_try_send')) return new Response(JSON.stringify('ok'), { status: 200 });
    throw new Error(`unexpected ${url}`);
  });
  const real = await sendOtp(sendRequest('3125550100', { 'x-real-ip': '192.0.2.15' }));
  assert.equal(real.status, 403);
  assert.equal(JSON.parse(fetchCalls[1].body || '{}').p_ip, '192.0.2.15');

  const unknown = await sendOtp(sendRequest('3125550100'));
  assert.equal(unknown.status, 403);
  const lastRpc = [...fetchCalls].reverse().find((call) => call.url.includes('/rpc/otp_try_send'));
  assert.equal(JSON.parse(lastRpc?.body || '{}').p_ip, 'unknown');
  assert.equal((await unknown.json()).error, 'This number is not registered. Contact Andre to get access.');
});

test('an unknown number under the limit keeps the 403 and is still counted', async () => {
  mockFetch((url) => {
    if (url.includes('/users?')) return new Response('[]', { status: 200 });
    if (url.includes('/rpc/otp_try_send')) return new Response(JSON.stringify('ok'), { status: 200 });
    throw new Error(`unexpected ${url}`);
  });
  const response = await sendOtp(sendRequest('5555550100'));
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, 'This number is not registered. Contact Andre to get access.');
  assert.deepEqual(fetchCalls.map((call) => call.method), ['GET', 'POST']);
  assert.match(fetchCalls[1].url, /\/rpc\/otp_try_send$/);
});

test('an unknown number over the limit gets 429 instead of 403', async () => {
  mockFetch((url) => {
    if (url.includes('/users?')) return new Response('[]', { status: 200 });
    if (url.includes('/rpc/otp_try_send')) return new Response(JSON.stringify('phone_limited'), { status: 200 });
    if (url.includes('/auth_settings')) return new Response('[]', { status: 200 });
    throw new Error(`unexpected ${url}`);
  });
  const response = await sendOtp(sendRequest('5555550100'));
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '600');
  assert.equal((await response.json()).error, 'Too many code requests. Wait a few minutes and try again.');
});

test('a missing rate-limit function fails closed before SMS', async () => {
  mockFetch((url) => {
    if (url.includes('/users?')) return new Response('[{"id":"user-test"}]', { status: 200 });
    if (url.includes('/rpc/otp_try_send')) return new Response('{"message":"function missing"}', { status: 404 });
    throw new Error(`unexpected ${url}`);
  });
  const prototype = (twilio as any).RequestClient.prototype;
  const originalRequest = prototype.request;
  let twilioCalls = 0;
  prototype.request = async () => {
    twilioCalls += 1;
    return { statusCode: 201, body: {}, headers: {} };
  };
  try {
    const response = await sendOtp(sendRequest('3125550100'));
    const body = await response.text();
    assert.equal(response.status, 503);
    assert.equal(body.includes('function missing'), false);
    assert.equal(twilioCalls, 0);
    assert.equal(fetchCalls.some((call) => call.url.endsWith('/otp_codes')), false);
  } finally {
    prototype.request = originalRequest;
  }
});

test('verify rejects an injected code before PostgREST', async () => {
  let fetches = 0;
  globalThis.fetch = (async () => {
    fetches += 1;
    throw new Error('unexpected fetch');
  }) as typeof fetch;
  const response = await verifyOtp(verifyRequest('3125550100', '1&or=(used.eq.true)'));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'Enter the 6-digit code' });
  assert.equal(fetches, 0);
  const route = readFileSync('app/api/auth/verify-otp/route.ts', 'utf8');
  assert.equal(route.includes('code=eq'), false);
  assert.equal(readFileSync('app/api/auth/send-otp/route.ts', 'utf8').includes('Math.random'), false);
});

test('verify maps locked and invalid without putting the code in the filter', async () => {
  mockFetch((url) => {
    if (url.includes('/rpc/otp_verify')) return new Response(JSON.stringify('locked'), { status: 200 });
    throw new Error(`unexpected ${url}`);
  });
  const locked = await verifyOtp(verifyRequest('(312) 555-0100', '123456'));
  assert.equal(locked.status, 429);
  assert.deepEqual(await locked.json(), { error: 'Too many attempts. Request a new code.' });
  const rpc = JSON.parse(fetchCalls[0].body || '{}');
  assert.equal(rpc.p_phone, '+13125550100');
  assert.equal(rpc.p_code_hash, hash('+13125550100', '123456'));
  assert.equal(fetchCalls[0].url.includes('code='), false);
  assert.equal(fetchCalls.length, 1);

  mockFetch(() => new Response(JSON.stringify('invalid'), { status: 200 }));
  const invalid = await verifyOtp(verifyRequest('3125550100', '000000'));
  assert.equal(invalid.status, 401);
  assert.deepEqual(await invalid.json(), { error: 'Invalid or expired code' });
});

test('a correct code sets the session cookie', async () => {
  mockFetch((url) => {
    if (url.includes('/rpc/otp_verify')) return new Response(JSON.stringify('ok'), { status: 200 });
    if (url.includes('/users?')) return new Response('[{"id":"user-1","name":"Ada","is_admin":false}]', { status: 200 });
    throw new Error(`unexpected ${url}`);
  });
  const response = await verifyOtp(verifyRequest('3125550100', '654321'));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, name: 'Ada', isAdmin: false });
  const cookies = response.headers.getSetCookie();
  const joined = cookies.join('\n');
  assert.match(joined, /mbl_session=/);
  assert.match(joined, /HttpOnly/);
  assert.match(joined, /Secure/);
  assert.match(joined, /SameSite=lax/i);
  assert.match(joined, /Max-Age=2592000/);
  assert.match(joined, /Path=\//);
  assert.match(joined, /mbl_auth=/);
  assert.equal(fetchCalls.some((call) => call.url.includes('code=')), false);
});

test('HTML and 5xx verify responses stay generic', async () => {
  const originalError = console.error;
  const logs: string[] = [];
  console.error = (...args: unknown[]) => logs.push(args.map(String).join(' '));
  try {
    mockFetch(() => new Response('<html>secret stack at /opt/app', { status: 200, headers: { 'content-type': 'text/html' } }));
    const html = await verifyOtp(verifyRequest('3125550100', '123456'));
    const htmlBody = await html.text();
    assert.equal(html.status, 503);
    assert.equal(htmlBody, JSON.stringify({ error: 'Sign-in service is temporarily unavailable. Please try again in a few minutes.' }));
    assert.equal(htmlBody.includes('<html>'), false);
    assert.equal(htmlBody.includes('secret stack'), false);

    mockFetch(() => new Response('upstream secret body and Error: stack', { status: 502 }));
    const failure = await verifyOtp(verifyRequest('3125550100', '123456'));
    const failureBody = await failure.text();
    assert.equal(failure.status, 503);
    assert.equal(failureBody.includes('upstream secret'), false);
    assert.equal(failureBody.includes('stack'), false);
    assert.equal(logs.join('\n').includes('upstream secret'), false);
    assert.equal(logs.join('\n').includes('<html>'), false);
    for (const line of logs) {
      const parsed = JSON.parse(line);
      assert.equal(parsed.event, 'verify-otp.failure');
      assert.equal(typeof parsed.kind, 'string');
    }
  } finally {
    console.error = originalError;
  }
});

test('missing pepper fails closed before SMS or verify lookups', async () => {
  const pepper = process.env.OTP_PEPPER;
  const secret = process.env.SESSION_SECRET;
  delete process.env.OTP_PEPPER;
  delete process.env.SESSION_SECRET;
  let fetches = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    fetches += 1;
    const url = String(input);
    if (url.includes('/users?')) return new Response('[{"id":"user-test"}]', { status: 200 });
    if (url.includes('/rpc/otp_try_send')) return new Response(JSON.stringify('ok'), { status: 200 });
    throw new Error(`unexpected ${url}`);
  }) as typeof fetch;
  const prototype = (twilio as any).RequestClient.prototype;
  const originalRequest = prototype.request;
  let twilioCalls = 0;
  prototype.request = async () => {
    twilioCalls += 1;
    throw new Error('sms should not be sent');
  };
  try {
    const send = await sendOtp(sendRequest('3125550100'));
    const sendBody = await send.text();
    assert.equal(send.status, 503);
    assert.equal(sendBody.includes('missing'), false);
    assert.equal(twilioCalls, 0);
    assert.equal(fetches, 2);

    fetches = 0;
    const verify = await verifyOtp(verifyRequest('3125550100', '123456'));
    const verifyBody = await verify.text();
    assert.equal(verify.status, 503);
    assert.equal(verifyBody, JSON.stringify({ error: 'Sign-in service is temporarily unavailable. Please try again in a few minutes.' }));
    assert.equal(fetches, 0);
  } finally {
    prototype.request = originalRequest;
    if (pepper === undefined) delete process.env.OTP_PEPPER;
    else process.env.OTP_PEPPER = pepper;
    if (secret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = secret;
  }
});

test('login code cleanup is recorded on the reminders cron and cannot fail the digest by itself', () => {
  const cron = readFileSync('app/api/cron/reminders/route.ts', 'utf8');
  assert.match(cron, /otp_send_log/);
  assert.match(cron, /otp_send_log_cleanup/);
  assert.match(cron, /instanceof DbError/);
  const vercel = readFileSync('vercel.json', 'utf8');
  assert.match(vercel, /0 13 \* \* \*/);
});
