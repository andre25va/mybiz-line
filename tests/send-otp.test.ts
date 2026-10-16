import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { NextRequest } from 'next/server';
import twilio from 'twilio';

const savedEnv = new Map<string, string | undefined>([
  ['SUPABASE_URL', process.env.SUPABASE_URL],
  ['SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY],
  ['TWILIO_ACCOUNT_SID', process.env.TWILIO_ACCOUNT_SID],
  ['TWILIO_AUTH_TOKEN', process.env.TWILIO_AUTH_TOKEN],
  ['TWILIO_PHONE_NUMBER', process.env.TWILIO_PHONE_NUMBER],
]);
let sendOtp: (request: NextRequest) => Promise<Response>;
let originalFetch: typeof fetch;
let fetchCalls: Array<{ url: string; method: string; signal?: AbortSignal }> = [];

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

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  fetchCalls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    fetchCalls.push({
      url: String(input),
      method: init?.method || 'GET',
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
  const response = await sendOtp(request());
  const body = await response.text();

  assert.equal(response.status, 503);
  assert.equal(body, JSON.stringify({ error: 'Sign-in is temporarily unavailable. Please try again shortly.' }));
  assert.equal(body.includes('private database detail'), false);
  assert.equal(fetchCalls.length, 1);
  assert.match(fetchCalls[0].url, /\/users\?/);
  assert.ok(fetchCalls[0].signal instanceof AbortSignal);
});

test('an inactive or missing user remains denied without invalidation or SMS', async () => {
  mockFetch(() => new Response('[]', { status: 200 }));
  const response = await sendOtp(request());
  const body = await response.json();

  assert.equal(response.status, 403);
  assert.equal(body.error, 'This number is not registered. Contact Andre to get access.');
  assert.equal(fetchCalls.length, 1);
  assert.match(fetchCalls[0].url, /\/users\?/);
});

test('malformed eligibility data fails closed as a dependency error', async () => {
  mockFetch(() => new Response('{"unexpected":"shape"}', { status: 200 }));
  const response = await sendOtp(request());
  const body = await response.text();

  assert.equal(response.status, 503);
  assert.equal(body, JSON.stringify({ error: 'Sign-in is temporarily unavailable. Please try again shortly.' }));
  assert.equal(fetchCalls.length, 1);
});

test('a failed old-code invalidation stops before insert or SMS', async () => {
  mockFetch((url, init) => {
    if (url.includes('/users?')) return new Response('[{"id":"user-test"}]', { status: 200 });
    if (url.includes('/otp_codes?phone=')) return new Response('{"message":"private db detail"}', { status: 503 });
    throw new Error(`unexpected mock request: ${init?.method || 'GET'}`);
  });
  const response = await sendOtp(request());
  const body = await response.text();

  assert.equal(response.status, 503);
  assert.equal(body, JSON.stringify({ error: 'Sign-in is temporarily unavailable. Please try again shortly.' }));
  assert.equal(body.includes('private db detail'), false);
  assert.deepEqual(fetchCalls.map(call => call.method), ['GET', 'PATCH']);
  assert.match(fetchCalls[1].url, /\/otp_codes\?phone=/);
});

test('a failed new-code insert stops before SMS and keeps the original invalidation order', async () => {
  mockFetch((url, init) => {
    if (url.includes('/users?')) return new Response('[{"id":"user-test"}]', { status: 200 });
    if (url.includes('/otp_codes?phone=')) return new Response(null, { status: 204 });
    if (url.endsWith('/otp_codes') && init?.method === 'POST') {
      return new Response('{"message":"private insert detail"}', { status: 500 });
    }
    throw new Error(`unexpected mock request: ${init?.method || 'GET'}`);
  });
  const response = await sendOtp(request());
  const body = await response.text();

  assert.equal(response.status, 503);
  assert.equal(body, JSON.stringify({ error: 'Sign-in is temporarily unavailable. Please try again shortly.' }));
  assert.equal(body.includes('private insert detail'), false);
  assert.deepEqual(fetchCalls.map(call => call.method), ['GET', 'PATCH', 'POST']);
  assert.match(fetchCalls[1].url, /\/otp_codes\?phone=/);
  assert.ok(fetchCalls[2].url.endsWith('/otp_codes'));
});

test('an empty insert representation is rejected before contacting Twilio', async () => {
  mockFetch((url, init) => {
    if (url.includes('/users?')) return new Response('[{"id":"user-test"}]', { status: 200 });
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
    const response = await sendOtp(request());
    assert.equal(response.status, 503);
    assert.equal(twilioCalls, 0);
    assert.deepEqual(fetchCalls.map(call => call.method), ['GET', 'PATCH', 'POST']);
  } finally {
    prototype.request = originalRequest;
  }
});

test('successful database path reaches Twilio SDK with bounded no-retry client and succeeds using a mock', async () => {
  mockFetch((url, init) => {
    if (url.includes('/users?')) return new Response('[{"id":"user-test"}]', { status: 200 });
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
    assert.deepEqual(fetchCalls.map(call => call.method), ['GET', 'PATCH', 'POST']);
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
    if (url.includes('/otp_codes?phone=')) return new Response(null, { status: 204 });
    if (url.endsWith('/otp_codes') && init?.method === 'POST') {
      return new Response('[{"id":"otp-test"}]', { status: 201 });
    }
    throw new Error('unexpected database mock request');
  });

  const prototype = (twilio as any).RequestClient.prototype;
  const originalRequest = prototype.request;
  prototype.request = async () => { throw new Error('private Twilio response detail'); };

  try {
    const response = await sendOtp(request());
    const body = await response.text();
    assert.equal(response.status, 502);
    assert.equal(body, JSON.stringify({ error: 'Could not confirm delivery. A code may still arrive; check before requesting another.' }));
    assert.equal(body.includes('private Twilio response detail'), false);
    assert.deepEqual(fetchCalls.map(call => call.method), ['GET', 'PATCH', 'POST']);
  } finally {
    prototype.request = originalRequest;
  }
});

test('a stalled Supabase lookup is aborted and returns a bounded generic failure', async () => {
  mockFetch((_url, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
  }));
  const start = Date.now();
  const response = await sendOtp(request());
  const body = await response.text();

  assert.equal(response.status, 503);
  assert.equal(body, JSON.stringify({ error: 'Sign-in is temporarily unavailable. Please try again shortly.' }));
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].signal?.aborted, true);
  assert.ok(Date.now() - start < 8_000);
});
