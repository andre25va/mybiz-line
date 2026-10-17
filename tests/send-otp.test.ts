import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { after, before, test } from 'node:test';
import { NextRequest } from 'next/server';
import twilio from 'twilio';

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
let originalFetch: typeof fetch;
let fetchCalls: Array<{ url: string; method: string; body?: string; signal?: AbortSignal }> = [];

function restoreEnv() {
  savedEnv.forEach((value, name) => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  });
}

function request() {
  return new NextRequest('http://localhost/api/auth/send-otp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone: '3125550100' }),
  });
}

async function captureFailureLogs<T>(operation: () => Promise<T>) {
  const originalError = console.error;
  const logs: string[] = [];
  console.error = (...args: unknown[]) => {
    logs.push(args.map((arg) => typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' '));
  };
  try {
    return { result: await operation(), logs };
  } finally {
    console.error = originalError;
  }
}

function assertSafeFailureLog(logs: string[], expected: Record<string, string | number>) {
  assert.equal(logs.length, 1, 'expected exactly one failure log');
  assert.deepEqual(JSON.parse(logs[0]), {
    event: 'send-otp.failure',
    ...expected,
  });
  assert.equal(logs[0].includes('3125550100'), false);
  assert.equal(logs[0].includes('test-only-service-role-key'), false);
  assert.equal(logs[0].includes('test-only-auth-token'), false);
}

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  fetchCalls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    fetchCalls.push({
      url: String(input),
      method: init?.method || 'GET',
      body: typeof init?.body === 'string' ? init.body : undefined,
      signal: init?.signal as AbortSignal | undefined,
    });
    return handler(String(input), init);
  }) as typeof fetch;
}

before(async () => {
  process.env.SUPABASE_URL = 'https://supabase.mock.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-service-role-key';
  process.env.TWILIO_ACCOUNT_SID = `AC${'a'.repeat(32)}`;
  process.env.TWILIO_AUTH_TOKEN = 'test-only-auth-token';
  process.env.TWILIO_PHONE_NUMBER = '+15555550100';
  process.env.SESSION_SECRET = 'test-only-session-secret';
  delete process.env.OTP_PEPPER;
  ({ POST: sendOtp } = await import('../app/api/auth/send-otp/route'));
});

before(() => {
  originalFetch = globalThis.fetch;
});

after(() => {
  globalThis.fetch = originalFetch;
  restoreEnv();
});

test('HTTP errors from the user lookup fail closed without reaching SMS', async () => {
  mockFetch(() => new Response(JSON.stringify({ message: 'private database detail' }), { status: 503 }));
  const { result: response, logs } = await captureFailureLogs(() => sendOtp(request()));
  const body = await response.text();

  assert.equal(response.status, 503);
  assert.equal(body, JSON.stringify({ error: 'Sign-in is temporarily unavailable. Please try again shortly.' }));
  assert.equal(body.includes('private database detail'), false);
  assert.equal(fetchCalls.length, 1);
  assert.match(fetchCalls[0].url, /\/users\?/);
  assert.ok(fetchCalls[0].signal instanceof AbortSignal);
  assertSafeFailureLog(logs, { phase: 'eligibility_lookup', errorClass: 'http', upstreamStatus: 503 });
  assert.equal(logs.join(' ').includes('private database detail'), false);
});

test('an inactive or missing user remains denied without invalidation or SMS', async () => {
  mockFetch((url) => {
    if (url.includes('/users?')) return new Response('[]', { status: 200 });
    if (url.includes('/rpc/otp_try_send')) return new Response(JSON.stringify('ok'), { status: 200 });
    throw new Error(`unexpected mock request: ${url}`);
  });
  const response = await sendOtp(request());
  const body = await response.json();

  assert.equal(response.status, 403);
  assert.equal(body.error, 'This number is not registered. Contact Andre to get access.');
  assert.deepEqual(fetchCalls.map(call => call.method), ['GET', 'POST']);
  assert.match(fetchCalls[0].url, /\/users\?/);
  assert.match(fetchCalls[1].url, /\/rpc\/otp_try_send$/);
});

test('malformed eligibility data fails closed as a dependency error', async () => {
  mockFetch(() => new Response('{"unexpected":"shape"}', { status: 200 }));
  const { result: response, logs } = await captureFailureLogs(() => sendOtp(request()));
  const body = await response.text();

  assert.equal(response.status, 503);
  assert.equal(body, JSON.stringify({ error: 'Sign-in is temporarily unavailable. Please try again shortly.' }));
  assert.equal(fetchCalls.length, 1);
  assertSafeFailureLog(logs, { phase: 'eligibility_lookup', errorClass: 'invalid_response' });
});

test('invalid upstream JSON is classified as an invalid response without exposing its text', async () => {
  mockFetch(() => new Response('private-token body 123456', { status: 200 }));
  const { result: response, logs } = await captureFailureLogs(() => sendOtp(request()));
  const body = await response.text();

  assert.equal(response.status, 503);
  assert.equal(body, JSON.stringify({ error: 'Sign-in is temporarily unavailable. Please try again shortly.' }));
  assertSafeFailureLog(logs, { phase: 'eligibility_lookup', errorClass: 'invalid_response' });
  assert.equal(logs.join(' ').includes('private-token'), false);
  assert.equal(logs.join(' ').includes('123456'), false);
});

test('a failed old-code invalidation stops before insert or SMS', async () => {
  mockFetch((url, init) => {
    if (url.includes('/users?')) return new Response('[{"id":"user-test"}]', { status: 200 });
    if (url.includes('/rpc/otp_try_send')) return new Response(JSON.stringify('ok'), { status: 200 });
    if (url.includes('/auth_settings')) return new Response('[{"value":600}]', { status: 200 });
    if (url.includes('/otp_codes?phone=')) return new Response('{"message":"private db detail"}', { status: 503 });
    throw new Error(`unexpected mock request: ${init?.method || 'GET'}`);
  });
  const { result: response, logs } = await captureFailureLogs(() => sendOtp(request()));
  const body = await response.text();

  assert.equal(response.status, 503);
  assert.equal(body, JSON.stringify({ error: 'Sign-in is temporarily unavailable. Please try again shortly.' }));
  assert.equal(body.includes('private db detail'), false);
  assert.deepEqual(fetchCalls.map(call => call.method), ['GET', 'POST', 'GET', 'PATCH']);
  assert.match(fetchCalls[3].url, /\/otp_codes\?phone=/);
  assertSafeFailureLog(logs, { phase: 'otp_invalidation', errorClass: 'http', upstreamStatus: 503 });
  assert.equal(logs.join(' ').includes('private db detail'), false);
});

test('a failed new-code insert stops before SMS and keeps the original invalidation order', async () => {
  mockFetch((url, init) => {
    if (url.includes('/users?')) return new Response('[{"id":"user-test"}]', { status: 200 });
    if (url.includes('/rpc/otp_try_send')) return new Response(JSON.stringify('ok'), { status: 200 });
    if (url.includes('/auth_settings')) return new Response('[{"value":600}]', { status: 200 });
    if (url.includes('/otp_codes?phone=')) return new Response(null, { status: 204 });
    if (url.endsWith('/otp_codes') && init?.method === 'POST') {
      return new Response('{"message":"private insert detail"}', { status: 500 });
    }
    throw new Error(`unexpected mock request: ${init?.method || 'GET'}`);
  });
  const { result: response, logs } = await captureFailureLogs(() => sendOtp(request()));
  const body = await response.text();

  assert.equal(response.status, 503);
  assert.equal(body, JSON.stringify({ error: 'Sign-in is temporarily unavailable. Please try again shortly.' }));
  assert.equal(body.includes('private insert detail'), false);
  assert.deepEqual(fetchCalls.map(call => call.method), ['GET', 'POST', 'GET', 'PATCH', 'POST']);
  assert.match(fetchCalls[3].url, /\/otp_codes\?phone=/);
  assert.ok(fetchCalls[4].url.endsWith('/otp_codes'));
  assertSafeFailureLog(logs, { phase: 'otp_insertion', errorClass: 'http', upstreamStatus: 500 });
  assert.equal(logs.join(' ').includes('private insert detail'), false);
});

test('an empty insert representation is rejected before contacting Twilio', async () => {
  mockFetch((url, init) => {
    if (url.includes('/users?')) return new Response('[{"id":"user-test"}]', { status: 200 });
    if (url.includes('/rpc/otp_try_send')) return new Response(JSON.stringify('ok'), { status: 200 });
    if (url.includes('/auth_settings')) return new Response('[{"value":600}]', { status: 200 });
    if (url.includes('/otp_codes?phone=')) return new Response(null, { status: 204 });
    if (url.endsWith('/otp_codes') && init?.method === 'POST') return new Response('[]', { status: 201 });
    throw new Error('unexpected database mock request');
  });

  const prototype = (twilio as any).RequestClient.prototype;
  const originalRequest = prototype.request;
  let twilioCalls = 0;
  prototype.request = async () => {
    twilioCalls += 1;
    return { statusCode: 201, body: { sid: 'SMmock' }, headers: {} };
  };

  try {
    const { result: response, logs } = await captureFailureLogs(() => sendOtp(request()));
    assert.equal(response.status, 503);
    assert.equal(twilioCalls, 0);
    assert.deepEqual(fetchCalls.map(call => call.method), ['GET', 'POST', 'GET', 'PATCH', 'POST']);
    assertSafeFailureLog(logs, { phase: 'otp_insertion', errorClass: 'invalid_response' });
  } finally {
    prototype.request = originalRequest;
  }
});

test('successful database path reaches Twilio SDK with bounded no-retry client and succeeds using a mock', async () => {
  mockFetch((url, init) => {
    if (url.includes('/users?')) return new Response('[{"id":"user-test"}]', { status: 200 });
    if (url.includes('/rpc/otp_try_send')) return new Response(JSON.stringify('ok'), { status: 200 });
    if (url.includes('/auth_settings')) return new Response('[{"value":600}]', { status: 200 });
    if (url.includes('/otp_codes?phone=')) return new Response(null, { status: 204 });
    if (url.endsWith('/otp_codes') && init?.method === 'POST') {
      return new Response('[{"id":"otp-test"}]', { status: 201 });
    }
    throw new Error('unexpected database mock request');
  });

  const prototype = (twilio as any).RequestClient.prototype;
  const originalRequest = prototype.request;
  let twilioCall: { uri: string; method: string; data: Record<string, unknown>; timeout: number; autoRetry: boolean } | undefined;
  prototype.request = async function (options: { uri: string; method: string; data: Record<string, unknown> }) {
    twilioCall = {
      uri: options.uri,
      method: options.method,
      data: options.data,
      timeout: this.defaultTimeout,
      autoRetry: this.autoRetry,
    };
    return {
      statusCode: 201,
      body: { sid: 'SMmock', to: '+13125550100', status: 'queued' },
      headers: {},
    };
  };

  try {
    const response = await sendOtp(request());
    assert.ok(twilioCall, 'Twilio SDK request was not intercepted');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.deepEqual(fetchCalls.map(call => call.method), ['GET', 'POST', 'GET', 'PATCH', 'POST']);
    const insert = fetchCalls.find((call) => call.method === 'POST' && call.url.endsWith('/otp_codes'));
    const stored = JSON.parse(insert?.body || '{}');
    const smsCode = String(twilioCall?.data.Body).match(/code: (\d{6})/)?.[1];
    assert.equal(stored.code, null);
    assert.match(stored.code_hash, /^[0-9a-f]{64}$/);
    assert.equal(stored.phone, '+13125550100');
    assert.equal(stored.used, false);
    assert.equal(stored.attempts, 0);
    assert.equal(smsCode?.length, 6);
    assert.equal(
      stored.code_hash,
      createHmac('sha256', 'test-only-session-secret').update(`+13125550100:${smsCode}`).digest('hex'),
    );
    assert.equal(JSON.stringify(stored).includes(smsCode as string), false);
    assert.equal(twilioCall?.method, 'post');
    assert.match(twilioCall?.uri || '', /\/Messages\.json$/);
    assert.equal(twilioCall?.timeout, 10_000);
    assert.equal(twilioCall?.autoRetry, false);
    assert.equal(typeof twilioCall?.data.Body, 'string');
    assert.equal(String(twilioCall?.data.Body).includes('Valid for 10 minutes.'), true);
  } finally {
    prototype.request = originalRequest;
  }
});

test('Twilio rejection is redacted and returns an uncertain-delivery response', async () => {
  mockFetch((url, init) => {
    if (url.includes('/users?')) return new Response('[{"id":"user-test"}]', { status: 200 });
    if (url.includes('/rpc/otp_try_send')) return new Response(JSON.stringify('ok'), { status: 200 });
    if (url.includes('/auth_settings')) return new Response('[{"value":600}]', { status: 200 });
    if (url.includes('/otp_codes?phone=')) return new Response(null, { status: 204 });
    if (url.endsWith('/otp_codes') && init?.method === 'POST') {
      return new Response('[{"id":"otp-test"}]', { status: 201 });
    }
    throw new Error('unexpected database mock request');
  });

  const prototype = (twilio as any).RequestClient.prototype;
  const originalRequest = prototype.request;
  prototype.request = async () => {
    throw Object.assign(new Error('secret phone 3125550100 otp 123456 token private Twilio detail'), {
      status: 503,
      code: 30003,
    });
  };

  try {
    const { result: response, logs } = await captureFailureLogs(() => sendOtp(request()));
    const body = await response.text();
    assert.equal(response.status, 502);
    assert.equal(body, JSON.stringify({ error: 'Could not confirm delivery. A code may still arrive; check before requesting another.' }));
    assert.equal(body.includes('private Twilio response detail'), false);
    assert.deepEqual(fetchCalls.map(call => call.method), ['GET', 'POST', 'GET', 'PATCH', 'POST']);
    assertSafeFailureLog(logs, {
      phase: 'sms', errorClass: 'http', upstreamStatus: 503, providerCode: 30003,
    });
    for (const secret of ['secret phone', '3125550100', '123456', 'token', 'private Twilio detail']) {
      assert.equal(logs.join(' ').includes(secret), false);
    }
  } finally {
    prototype.request = originalRequest;
  }
});

test('a stalled Supabase lookup is aborted and returns a bounded generic failure', async () => {
  mockFetch((_url, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
  }));
  const start = Date.now();
  const { result: response, logs } = await captureFailureLogs(() => sendOtp(request()));
  const body = await response.text();

  assert.equal(response.status, 503);
  assert.equal(body, JSON.stringify({ error: 'Sign-in is temporarily unavailable. Please try again shortly.' }));
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].signal?.aborted, true);
  assert.ok(Date.now() - start < 8_000);
  assertSafeFailureLog(logs, { phase: 'eligibility_lookup', errorClass: 'timeout' });
});

test('network exception containing secrets is classified without logging its message', async () => {
  mockFetch(() => { throw new TypeError('secret phone 3125550100 otp 654321 key private-value'); });
  const { result: response, logs } = await captureFailureLogs(() => sendOtp(request()));
  const body = await response.text();

  assert.equal(response.status, 503);
  assert.equal(body, JSON.stringify({ error: 'Sign-in is temporarily unavailable. Please try again shortly.' }));
  assertSafeFailureLog(logs, { phase: 'eligibility_lookup', errorClass: 'network' });
  for (const secret of ['secret phone', '3125550100', '654321', 'key', 'private-value']) {
    assert.equal(logs.join(' ').includes(secret), false);
  }
});
