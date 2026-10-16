import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { NextRequest } from 'next/server';

const savedEnv = new Map<string, string | undefined>([
  ['SUPABASE_URL', process.env.SUPABASE_URL],
  ['SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY],
  ['TWILIO_ACCOUNT_SID', process.env.TWILIO_ACCOUNT_SID],
  ['TWILIO_AUTH_TOKEN', process.env.TWILIO_AUTH_TOKEN],
  ['TWILIO_PHONE_NUMBER', process.env.TWILIO_PHONE_NUMBER],
]);
let sendOtp: (request: NextRequest) => Promise<Response>;
let originalFetch: typeof fetch;

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

before(async () => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.TWILIO_ACCOUNT_SID = `AC${'a'.repeat(32)}`;
  process.env.TWILIO_AUTH_TOKEN = 'test-secret-twilio-token';
  process.env.TWILIO_PHONE_NUMBER = '+15555550100';
  ({ POST: sendOtp } = await import('../app/api/auth/send-otp/route'));
  originalFetch = globalThis.fetch;
});

after(() => {
  globalThis.fetch = originalFetch;
  restoreEnv();
});

test('missing Supabase config is a safe configuration-phase failure before fetch', async () => {
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error('unexpected fetch');
  }) as typeof fetch;
  const originalError = console.error;
  const logs: string[] = [];
  console.error = (...args: unknown[]) => logs.push(args.map(String).join(' '));

  try {
    const response = await sendOtp(request());
    assert.equal(response.status, 503);
    assert.equal(await response.text(), JSON.stringify({ error: 'Sign-in is temporarily unavailable. Please try again shortly.' }));
    assert.equal(fetchCalls, 0);
    assert.equal(logs.length, 1);
    assert.deepEqual(JSON.parse(logs[0]), {
      event: 'send-otp.failure',
      phase: 'configuration',
      errorClass: 'missing_config',
    });
    assert.equal(logs.join(' ').includes('3125550100'), false);
    assert.equal(logs.join(' ').includes('test-secret-twilio-token'), false);
  } finally {
    console.error = originalError;
  }
});
