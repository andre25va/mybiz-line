import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import https, { type RequestOptions } from 'node:https';
import type { ClientRequest, IncomingMessage } from 'node:http';
import type { TLSSocket } from 'node:tls';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { NextRequest } from 'next/server';

const host = 'alxrmusieuzgssynktxg.supabase.co';
const serviceKey = 'diagnostic-test-service-key';
const sessionSecret = 'diagnostic-test-session-secret';
const adminId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const privateLeak = 'private-user-row-must-not-leak-+15555550123';
const originalEnv = new Map<string, string | undefined>([
  ['SESSION_SECRET', process.env.SESSION_SECRET],
  ['SUPABASE_URL', process.env.SUPABASE_URL],
  ['SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY],
]);

type ResponseSpec = { status: number; body?: string };
type Scenario = (request: FakeRequest, callback: (response: IncomingMessage) => void) => void;

class FakeResponse extends EventEmitter {
  statusCode: number;
  private readonly body: string;
  constructor(spec: ResponseSpec) {
    super();
    this.statusCode = spec.status;
    this.body = spec.body ?? '';
  }
  resume() {
    queueMicrotask(() => {
      if (this.body) this.emit('data', this.body);
      this.emit('end');
    });
    return this;
  }
}

class FakeRequest extends EventEmitter {
  destroyed = false;
  constructor(private readonly scenario: Scenario, private readonly callback: (response: IncomingMessage) => void) {
    super();
  }
  end() { this.scenario(this, this.callback); }
  destroy() { this.destroyed = true; return this; }
}

let originalHttpsRequest: typeof https.request;
let signSession: (userId: string) => string;
let diagnosticPost: (request: NextRequest) => Promise<Response>;
let queued: Scenario[] = [];
let requestRecords: Array<{ url: string; options: RequestOptions }> = [];
let logLines: string[] = [];
let originalConsoleError: typeof console.error;
let originalConsoleInfo: typeof console.info;

function restoreEnv() {
  originalEnv.forEach((value, name) => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  });
}

function handshake(request: FakeRequest) {
  const socket = new EventEmitter() as EventEmitter & { connecting: boolean };
  socket.connecting = true;
  request.emit('socket', socket as TLSSocket);
  socket.emit('lookup', null, '198.51.100.8', 'IPv4', `${privateLeak}.invalid`);
  socket.emit('connect');
  socket.emit('secureConnect');
  request.emit('finish');
}

function reply(spec: ResponseSpec): Scenario {
  return (request, callback) => {
    handshake(request);
    callback(new FakeResponse(spec) as unknown as IncomingMessage);
  };
}

function delayedReply(spec: ResponseSpec, delayMs: number): Scenario {
  return (request, callback) => {
    handshake(request);
    setTimeout(() => callback(new FakeResponse(spec) as unknown as IncomingMessage), delayMs);
  };
}

function networkFailure(code: string): Scenario {
  return request => {
    const socket = new EventEmitter() as EventEmitter & { connecting: boolean };
    socket.connecting = true;
    request.emit('socket', socket as TLSSocket);
    if (code === 'ENOTFOUND') {
      const error = Object.assign(new Error(privateLeak), { code });
      socket.emit('lookup', error);
      request.emit('error', error);
      return;
    }
    socket.emit('lookup', null, '198.51.100.8', 'IPv4', `${privateLeak}.invalid`);
    if (code === 'ECONNREFUSED') {
      request.emit('error', Object.assign(new Error(privateLeak), { code }));
      return;
    }
    socket.emit('connect');
    request.emit('error', Object.assign(new Error(privateLeak), { code }));
  };
}

function noResponse(): Scenario {
  return request => handshake(request);
}

function installScenarios(...scenarios: Scenario[]) {
  queued = [...scenarios];
  requestRecords = [];
  const mutable = https as unknown as { request: typeof https.request };
  mutable.request = ((url: URL, options: RequestOptions, callback: (response: IncomingMessage) => void) => {
    const scenario = queued.shift();
    assert.ok(scenario, 'unexpected outbound request');
    requestRecords.push({ url: url.href, options });
    return new FakeRequest(scenario, callback) as unknown as ClientRequest;
  }) as typeof https.request;
}

function captureLogs() {
  logLines = [];
  console.error = ((line: string) => { logLines.push(line); }) as typeof console.error;
  console.info = ((line: string) => { logLines.push(line); }) as typeof console.info;
}

function request(origin = 'http://localhost', userId = adminId) {
  return new NextRequest('http://localhost/api/admin/connection-diagnostic', {
    method: 'POST',
    headers: {
      origin,
      cookie: `mbl_session=${signSession(userId)}`,
    },
  });
}

async function body(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  for (const secret of [serviceKey, sessionSecret, privateLeak, adminId, otherId, host]) {
    assert.equal(text.includes(secret), false, `response leaked ${secret}`);
  }
  return JSON.parse(text) as Record<string, unknown>;
}

before(async () => {
  originalHttpsRequest = https.request;
  originalConsoleError = console.error;
  originalConsoleInfo = console.info;
  process.env.SESSION_SECRET = sessionSecret;
  process.env.SUPABASE_URL = `https://${host}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = serviceKey;
  ({ signSession } = await import('../lib/session'));
  ({ POST: diagnosticPost } = await import('../app/api/admin/connection-diagnostic/route'));
});

after(() => {
  (https as unknown as { request: typeof https.request }).request = originalHttpsRequest;
  console.error = originalConsoleError;
  console.info = originalConsoleInfo;
  restoreEnv();
});

test('missing, invalid, cross-origin, or absent session never triggers Supabase', async () => {
  installScenarios();
  const missing = await diagnosticPost(new NextRequest('http://localhost/api/admin/connection-diagnostic', {
    method: 'POST', headers: { origin: 'http://localhost' },
  }));
  assert.equal(missing.status, 401);
  assert.deepEqual(await body(missing), { error: 'Unauthorized' });
  const badOrigin = await diagnosticPost(request('https://evil.invalid'));
  assert.equal(badOrigin.status, 403);
  assert.deepEqual(await body(badOrigin), { error: 'Forbidden' });
  const invalidSession = await diagnosticPost(new NextRequest('http://localhost/api/admin/connection-diagnostic', {
    method: 'POST',
    headers: { origin: 'http://localhost', cookie: 'mbl_session=invalid' },
  }));
  assert.equal(invalidSession.status, 401);
  assert.equal(requestRecords.length, 0);
});

test('exact active-admin failures return generic forbidden and never run zero-row probe', async () => {
  const cases: Array<{ name: string; scenario: Scenario }> = [
    { name: 'inactive', scenario: reply({ status: 200, body: '[{"is_admin":true,"is_active":false}]' }) },
    { name: 'not admin', scenario: reply({ status: 200, body: '[{"is_admin":false,"is_active":true}]' }) },
    { name: 'duplicate rows', scenario: reply({ status: 200, body: '[{"is_admin":true,"is_active":true},{"is_admin":true,"is_active":true}]' }) },
    { name: 'malformed JSON', scenario: reply({ status: 200, body: 'not-json' }) },
    { name: 'non-array JSON', scenario: reply({ status: 200, body: '{"is_admin":true,"is_active":true}' }) },
    { name: 'HTTP failure', scenario: reply({ status: 503, body: privateLeak }) },
    { name: 'network failure', scenario: networkFailure('ECONNRESET') },
  ];
  for (const item of cases) {
    captureLogs();
    installScenarios(item.scenario);
    const response = await diagnosticPost(request());
    assert.equal(response.status, 403, item.name);
    assert.deepEqual(await body(response), { error: 'Forbidden' }, item.name);
    assert.equal(requestRecords.length, 1, `${item.name} must do auth read only`);
    assert.equal(queued.length, 0);
    const authTrace = JSON.parse(logLines[0]) as Record<string, unknown>;
    assert.equal(authTrace.phase, 'admin_authorization');
    for (const secret of [serviceKey, sessionSecret, privateLeak, adminId, host]) {
      assert.equal(logLines.join('\n').includes(secret), false, `${item.name} log leaked ${secret}`);
    }
  }
});

test('authorization timeout is bounded, logged safely, and prevents the diagnostic request', async () => {
  captureLogs();
  installScenarios(noResponse());
  const response = await diagnosticPost(request());
  assert.equal(response.status, 403);
  assert.deepEqual(await body(response), { error: 'Forbidden' });
  assert.equal(requestRecords.length, 1);
  const trace = JSON.parse(logLines[0]) as Record<string, unknown>;
  assert.equal(trace.phase, 'admin_authorization');
  assert.equal(trace.outcome, 'timeout');
  assert.equal(trace.failureStage, 'response');
  for (const secret of [serviceKey, sessionSecret, privateLeak, adminId, host]) {
    assert.equal(logLines.join('\n').includes(secret), false);
  }
});

test('one hard route deadline covers authorization plus the one conditional probe', async () => {
  captureLogs();
  installScenarios(
    delayedReply({ status: 200, body: '[{"is_admin":true,"is_active":true}]' }, 4_500),
    noResponse(),
  );
  const startedAt = Date.now();
  const response = await diagnosticPost(request());
  const elapsedMs = Date.now() - startedAt;
  assert.equal(response.status, 200);
  assert.ok(elapsedMs >= 7_500 && elapsedMs < 9_500, `total deadline was ${elapsedMs}ms`);
  assert.equal(requestRecords.length, 2);
  const result = await body(response);
  const diagnostic = result.diagnostic as Record<string, unknown>;
  assert.equal(diagnostic.phase, 'zero_row_probe');
  assert.equal(diagnostic.outcome, 'timeout');
  assert.equal(diagnostic.failureStage, 'response');
  assert.equal(logLines.length, 2);
});

test('missing server configuration fails closed without egress', async () => {
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  captureLogs();
  installScenarios();
  try {
    const result = await diagnosticPost(request());
    assert.equal(result.status, 403);
    assert.deepEqual(await body(result), { error: 'Forbidden' });
    assert.equal(requestRecords.length, 0);
    const trace = JSON.parse(logLines[0]) as Record<string, unknown>;
    assert.equal(trace.phase, 'admin_authorization');
    assert.equal(trace.outcome, 'invalid_config');
    assert.equal(trace.traceId && typeof trace.traceId, 'string');
  } finally {
    if (originalUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  }
});

test('authorized active admin can execute at most one zero-row GET and sees only safe evidence', async () => {
  const authBody = `[{"is_admin":true,"is_active":true,"unexpected":"${privateLeak}"}]`;
  captureLogs();
  installScenarios(
    reply({ status: 200, body: authBody }),
    reply({ status: 200, body: '[]' }),
  );
  const result = await diagnosticPost(request());
  assert.equal(result.status, 200);
  const json = await body(result);
  const diagnostic = json.diagnostic as Record<string, unknown>;
  assert.equal(diagnostic.phase, 'zero_row_probe');
  assert.equal(diagnostic.outcome, 'success');
  assert.equal(typeof diagnostic.traceId, 'string');
  assert.equal(requestRecords.length, 2, 'one ordinary auth read and one diagnostic read');
  assert.match(requestRecords[0].url, /\/rest\/v1\/users\?id=eq\.[0-9a-f-]+&select=is_admin,is_active&limit=1$/i);
  assert.match(requestRecords[1].url, /\/rest\/v1\/users\?select=id&limit=0$/);
  assert.equal(requestRecords[0].options.method, 'GET');
  assert.equal(requestRecords[1].options.method, 'GET');
  assert.equal(logLines.length, 2);
  for (const line of logLines) {
    for (const secret of [serviceKey, sessionSecret, privateLeak, adminId, host]) assert.equal(line.includes(secret), false);
  }
  assert.equal(JSON.stringify(json).includes('is_admin'), false);
  assert.equal(JSON.stringify(json).includes('is_active'), false);
});

test('probe failure is returned only to verified admin as safe fixed-schema evidence', async () => {
  captureLogs();
  installScenarios(
    reply({ status: 200, body: '[{"is_admin":true,"is_active":true}]' }),
    reply({ status: 502, body: privateLeak }),
  );
  const response = await diagnosticPost(request());
  assert.equal(response.status, 200);
  const json = await body(response);
  const diagnostic = json.diagnostic as Record<string, unknown>;
  assert.equal(diagnostic.phase, 'zero_row_probe');
  assert.equal(diagnostic.outcome, 'http');
  assert.equal(diagnostic.upstreamStatus, 502);
  assert.equal(JSON.stringify(diagnostic).includes(privateLeak), false);
  assert.equal(requestRecords.length, 2);
});

test('diagnostic route is manual-only and is not mounted in the admin UI', async () => {
  const adminClient = await readFile(new URL('../components/admin/AdminPortalClient.tsx', import.meta.url), 'utf8');
  const appShell = await readFile(new URL('../components/AppShell.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(adminClient, /connection-diagnostic/);
  assert.doesNotMatch(appShell, /connection-diagnostic/);
});
