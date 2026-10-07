import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import {
  createConcurrentAttemptGuard,
  fetchFreshToken,
  refreshDeviceToken,
  runBoundedActivation,
} from '../hooks/useTwilioDevice';
import { GET, dynamic } from '../app/api/token/route';

const envNames = ['TWILIO_ACCOUNT_SID', 'TWILIO_API_KEY', 'TWILIO_API_SECRET', 'TWILIO_TWIML_APP_SID'] as const;
const originalEnv = new Map(envNames.map(name => [name, process.env[name]]));
const testTokenSecret = 'test-only-token-secret';

function makeJwt(expirationSeconds: number) {
  const payload = Buffer.from(JSON.stringify({ exp: expirationSeconds })).toString('base64url');
  return `header.${payload}.signature`;
}

function tokenResponse(expirationMs = Date.now() + 10 * 60 * 1000, jwtExpirationMs = expirationMs) {
  return new Response(JSON.stringify({
    token: makeJwt(Math.floor(jwtExpirationMs / 1000)),
    expiresAt: new Date(expirationMs).toISOString(),
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

before(() => {
  process.env.TWILIO_ACCOUNT_SID = `AC${'1'.repeat(32)}`;
  process.env.TWILIO_API_KEY = `SK${'2'.repeat(32)}`;
  process.env.TWILIO_API_SECRET = testTokenSecret;
  process.env.TWILIO_TWIML_APP_SID = `AP${'3'.repeat(32)}`;
});

after(() => {
  for (const name of envNames) {
    const value = originalEnv.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

test('token route is dynamic, issues an expiring token, and disables browser and CDN caching', async () => {
  assert.equal(dynamic, 'force-dynamic');
  const response = await GET();
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control') || '', /no-store/i);
  assert.match(response.headers.get('cdn-cache-control') || '', /no-store/i);
  assert.match(response.headers.get('vercel-cdn-cache-control') || '', /no-store/i);
  assert.equal(response.headers.get('pragma'), 'no-cache');
  assert.equal(response.headers.get('expires'), '0');

  const body = await response.json() as { token: string; expiresAt: string };
  assert.equal(typeof body.token, 'string');
  assert.ok(body.token.length > 20);
  assert.ok(Date.parse(body.expiresAt) > Date.now() + 50 * 60 * 1000);
  const jwtPayload = JSON.parse(Buffer.from(body.token.split('.')[1], 'base64url').toString('utf8'));
  assert.ok(jwtPayload.exp * 1000 > Date.now() + 50 * 60 * 1000);
  assert.ok(Math.abs(Date.parse(body.expiresAt) - jwtPayload.exp * 1000) < 5_000);
});

test('token endpoint fails safely when server credentials are unavailable', async () => {
  const saved = process.env.TWILIO_API_SECRET;
  delete process.env.TWILIO_API_SECRET;
  try {
    const response = await GET();
    assert.equal(response.status, 503);
    assert.match(response.headers.get('cache-control') || '', /no-store/i);
    const body = await response.json() as { error: string };
    assert.equal(body.error, 'Phone token service is unavailable.');
    assert.equal(JSON.stringify(body).includes(testTokenSecret), false);
  } finally {
    if (saved === undefined) delete process.env.TWILIO_API_SECRET;
    else process.env.TWILIO_API_SECRET = saved;
  }
});

test('client requests fresh tokens with no-store and rejects expired or malformed expiry without exposing JWT', async () => {
  let requestUrl = '';
  let requestInit: RequestInit | undefined;
  const validToken = await fetchFreshToken(async (input, init) => {
    requestUrl = String(input);
    requestInit = init;
    return tokenResponse();
  });
  assert.equal(requestUrl, '/api/token');
  assert.equal(requestInit?.cache, 'no-store');
  assert.equal(new Headers(requestInit?.headers).get('cache-control'), 'no-cache');
  assert.ok(validToken.expiresAtMs > Date.now());

  const expiredToken = makeJwt(Math.floor((Date.now() - 1000) / 1000));
  const encodedSecret = `${expiredToken}-private`;
  await assert.rejects(
    () => fetchFreshToken(async () => new Response(JSON.stringify({ token: encodedSecret, expiresAt: new Date(Date.now() + 600_000).toISOString() }), { status: 200 })),
    error => error instanceof Error && /expired or has an invalid expiry/.test(error.message) && !error.message.includes(expiredToken),
  );
  await assert.rejects(
    () => fetchFreshToken(async () => new Response(JSON.stringify({ token: makeJwt(Math.floor((Date.now() + 600_000) / 1000)), expiresAt: new Date(Date.now() - 1000).toISOString() }), { status: 200 })),
    /expired or has an invalid expiry/,
  );
  await assert.rejects(
    () => fetchFreshToken(async () => new Response(JSON.stringify({ token: testTokenSecret }), { status: 200 })),
    /response was invalid/,
  );
  await assert.rejects(
    () => fetchFreshToken(async () => new Response(JSON.stringify({ token: testTokenSecret }), { status: 502 })),
    error => error instanceof Error && /HTTP 502/.test(error.message) && !error.message.includes(testTokenSecret),
  );
});

test('token refresh updates a device only with a newly validated token', async () => {
  let updatedToken = '';
  const fresh = {
    token: makeJwt(Math.floor((Date.now() + 20 * 60 * 1000) / 1000)),
    expiresAt: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
    expiresAtMs: Date.now() + 20 * 60 * 1000,
  };
  const result = await refreshDeviceToken({ updateToken: token => { updatedToken = token; } }, async () => fresh);
  assert.equal(updatedToken, fresh.token);
  assert.equal(result.expiresAt, fresh.expiresAt);
});

test('activation retries are bounded and a later fresh gesture can retry a failed attempt', async () => {
  let gestureCanSucceed = false;
  let registrationAttempts = 0;
  const activate = createConcurrentAttemptGuard(() => runBoundedActivation(async () => {
    registrationAttempts++;
    if (!gestureCanSucceed) throw new Error('transient');
  }, { maxAttempts: 3, retryDelayMs: 0 }));

  const firstGesture = activate();
  const duplicateGesture = activate();
  assert.equal(firstGesture, duplicateGesture);
  await assert.rejects(firstGesture, /transient/);
  assert.equal(registrationAttempts, 3);

  gestureCanSucceed = true;
  await activate();
  assert.equal(registrationAttempts, 4);
});

test('phone activation control prevents overlapping registration attempts', async () => {
  let attempts = 0;
  let release: (() => void) | undefined;
  const activate = createConcurrentAttemptGuard(() => new Promise<void>(resolve => {
    attempts++;
    release = resolve;
  }));
  const first = activate();
  const duplicate = activate();
  assert.equal(first, duplicate);
  assert.equal(attempts, 0); // task starts in the same microtask for both calls
  await Promise.resolve();
  assert.equal(attempts, 1);
  release?.();
  await Promise.all([first, duplicate]);
  assert.equal(attempts, 1);
});

test('dialpad and app header report activation state and expose the same explicit action', async () => {
  const dialpad = await readFile(new URL('../components/Dialpad.tsx', import.meta.url), 'utf8');
  const appShell = await readFile(new URL('../components/AppShell.tsx', import.meta.url), 'utf8');
  const hook = await readFile(new URL('../hooks/useTwilioDevice.ts', import.meta.url), 'utf8');
  for (const stateLabel of ['Initializing phone…', 'Activating phone…', '● Ready', 'Activation failed', 'Phone not registered']) {
    assert.ok(dialpad.includes(stateLabel), `Dialpad should display state ${stateLabel}`);
  }
  assert.match(dialpad, /state === 'error' \? 'Retry activation' : 'Activate phone'/);
  assert.match(dialpad, /data-action="activate-phone"/);
  assert.match(dialpad, /role="alert"/);
  assert.doesNotMatch(dialpad, /Tap screen to activate/);
  assert.match(appShell, /Initializing…/);
  assert.match(appShell, /Activating…/);
  assert.match(appShell, /activationState === 'error' \? 'Retry' : 'Activate'/);
  assert.equal((appShell.match(/data-action="activate-phone"/g) || []).length, 2);
  assert.doesNotMatch(appShell, /Connecting…/);
  assert.match(hook, /device\.on\('incoming'/);
  assert.match(hook, /deviceRef\.current\.connect\(\{ params: \{ To: to \} \}\)/);
});
