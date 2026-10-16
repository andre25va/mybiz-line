import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { RequestOptions } from 'node:https';
import type { ClientRequest, IncomingMessage } from 'node:http';
import type { TLSSocket } from 'node:tls';
import { test } from 'node:test';
import {
  createDiagnosticFetch,
  validateZeroRowResponse,
  type ConnectionDiagnosticPhase,
} from '../lib/supabase-connection-diagnostic';

const host = 'supabase-test-project.supabase.co';
const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const key = 'diagnostic-service-key-must-not-appear';
const leak = 'private-leak-message-+15555550123';

type FakeResponseSpec = { status: number; body?: string };
type FakeScenario = (request: FakeRequest, callback: (response: IncomingMessage) => void) => void;

class FakeResponse extends EventEmitter {
  readonly statusCode: number;
  private readonly body: string;

  constructor(spec: FakeResponseSpec) {
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
  constructor(private readonly scenario: FakeScenario, private readonly callback: (response: IncomingMessage) => void) {
    super();
  }
  end() { this.scenario(this, this.callback); }
  destroy() { this.destroyed = true; return this; }
}

function socketFor(request: FakeRequest) {
  const socket = new EventEmitter() as EventEmitter & { connecting: boolean };
  socket.connecting = true;
  request.emit('socket', socket as TLSSocket);
  return socket;
}

function normalHandshakes(request: FakeRequest) {
  const socket = socketFor(request);
  socket.emit('lookup', null, '198.51.100.20', 'IPv4', `${leak}.invalid`);
  socket.emit('connect');
  socket.emit('secureConnect');
  request.emit('finish');
}

function responseScenario(spec: FakeResponseSpec): FakeScenario {
  return (request, callback) => {
    normalHandshakes(request);
    callback(new FakeResponse(spec) as unknown as IncomingMessage);
  };
}

function requestFactoryFor(scenario: FakeScenario, seen?: { url?: string; options?: RequestOptions }) {
  return ((url: URL, options: RequestOptions, callback: (response: IncomingMessage) => void) => {
    if (seen) {
      seen.url = url.href;
      seen.options = options;
    }
    return new FakeRequest(scenario, callback) as unknown as ClientRequest;
  }) as never;
}

function queryFor(phase: ConnectionDiagnosticPhase) {
  return phase === 'zero_row_probe'
    ? `https://${host}/rest/v1/users?select=id&limit=0`
    : `https://${host}/rest/v1/users?id=eq.${userId}&select=is_admin,is_active&limit=1`;
}

function headers() {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    Accept: 'application/json',
  };
}

function noSecretOrRawError(value: unknown) {
  const serialized = JSON.stringify(value);
  assert.equal(serialized.includes(key), false);
  assert.equal(serialized.includes(leak), false);
  assert.equal(serialized.includes(userId), false);
  assert.equal(serialized.includes(host), false);
}

test('zero-row probe performs only GET limit=0 and yields a safe successful trace', async () => {
  const seen: { url?: string; options?: RequestOptions } = {};
  const observed = createDiagnosticFetch({
    phase: 'zero_row_probe',
    deadlineAt: Date.now() + 2_000,
    requestFactory: requestFactoryFor(responseScenario({ status: 200, body: '[]' }), seen),
    expectedHost: host,
  });
  const response = await observed.fetcher(queryFor('zero_row_probe'), { method: 'GET', headers: headers() });
  const trace = await validateZeroRowResponse(response, observed.getTrace());
  assert.equal(seen.url, queryFor('zero_row_probe'));
  assert.equal(seen.options?.method, 'GET');
  assert.equal(trace?.phase, 'zero_row_probe');
  assert.equal(trace?.outcome, 'success');
  assert.deepEqual(trace?.milestones.map(item => item.stage), ['dns', 'connect', 'tls', 'request', 'response']);
  noSecretOrRawError(trace);
});

test('active-admin authorization query remains exact and is never exposed in trace', async () => {
  const seen: { url?: string; options?: RequestOptions } = {};
  const observed = createDiagnosticFetch({
    phase: 'admin_authorization',
    deadlineAt: Date.now() + 2_000,
    requestFactory: requestFactoryFor(responseScenario({ status: 200, body: '[{"is_admin":true,"is_active":true}]' }), seen),
    expectedHost: host,
  });
  const response = await observed.fetcher(queryFor('admin_authorization'), { method: 'GET', headers: headers() });
  assert.deepEqual(await response.json(), [{ is_admin: true, is_active: true }]);
  assert.equal(seen.url, queryFor('admin_authorization'));
  assert.equal(seen.options?.method, 'GET');
  noSecretOrRawError(observed.getTrace());
});

test('DNS, TCP connect, and TLS errors are separately classified without raw error text', async () => {
  const cases: Array<{ phase: ConnectionDiagnosticPhase; stage: string; code: string; scenario: FakeScenario }> = [
    {
      phase: 'zero_row_probe', stage: 'dns', code: 'ENOTFOUND',
      scenario: request => {
        const socket = socketFor(request);
        const error = Object.assign(new Error(leak), { code: 'ENOTFOUND' });
        socket.emit('lookup', error);
        request.emit('error', error);
      },
    },
    {
      phase: 'zero_row_probe', stage: 'connect', code: 'ECONNREFUSED',
      scenario: request => {
        const socket = socketFor(request);
        socket.emit('lookup', null, '198.51.100.20', 'IPv4', `${leak}.invalid`);
        const error = Object.assign(new Error(leak), { code: 'ECONNREFUSED' });
        request.emit('error', error);
      },
    },
    {
      phase: 'zero_row_probe', stage: 'tls', code: 'ECONNRESET',
      scenario: request => {
        const socket = socketFor(request);
        socket.emit('lookup', null, '198.51.100.20', 'IPv4', `${leak}.invalid`);
        socket.emit('connect');
        const error = Object.assign(new Error(leak), { code: 'ECONNRESET' });
        request.emit('error', error);
      },
    },
  ];

  for (const item of cases) {
    const observed = createDiagnosticFetch({
      phase: item.phase,
      deadlineAt: Date.now() + 1_000,
      requestFactory: requestFactoryFor(item.scenario),
      expectedHost: host,
    });
    await assert.rejects(observed.fetcher(queryFor(item.phase), { headers: headers() }));
    const trace = observed.getTrace();
    assert.equal(trace?.outcome, 'network');
    assert.equal(trace?.failureStage, item.stage);
    assert.equal(trace?.networkCode, item.code);
    noSecretOrRawError(trace);
  }
});

test('timeout before response records only response-wait stage', async () => {
  const scenario: FakeScenario = request => {
    normalHandshakes(request);
    // Do not deliver response headers; request-scoped timer owns the timeout.
  };
  const observed = createDiagnosticFetch({
    phase: 'zero_row_probe',
    deadlineAt: Date.now() + 50,
    requestTimeoutMs: 20,
    requestFactory: requestFactoryFor(scenario),
    expectedHost: host,
  });
  await assert.rejects(observed.fetcher(queryFor('zero_row_probe'), { headers: headers() }));
  const trace = observed.getTrace();
  assert.equal(trace?.outcome, 'timeout');
  assert.equal(trace?.failureStage, 'response');
  assert.deepEqual(trace?.milestones.map(item => item.stage), ['dns', 'connect', 'tls', 'request']);
  noSecretOrRawError(trace);
});

test('HTTP status is numeric-only and upstream bodies are discarded', async () => {
  const observed = createDiagnosticFetch({
    phase: 'zero_row_probe',
    deadlineAt: Date.now() + 1_000,
    requestFactory: requestFactoryFor(responseScenario({ status: 503, body: leak })),
    expectedHost: host,
  });
  const response = await observed.fetcher(queryFor('zero_row_probe'), { headers: headers() });
  assert.equal(response.status, 503);
  assert.equal(await response.text(), '');
  const trace = observed.getTrace();
  assert.equal(trace?.outcome, 'http');
  assert.equal(trace?.upstreamStatus, 503);
  noSecretOrRawError(trace);
});

test('zero-row success accepts only an empty array and redacts unexpected content', async () => {
  const observed = createDiagnosticFetch({
    phase: 'zero_row_probe',
    deadlineAt: Date.now() + 1_000,
    requestFactory: requestFactoryFor(responseScenario({ status: 200, body: `["${leak}"]` })),
    expectedHost: host,
  });
  const response = await observed.fetcher(queryFor('zero_row_probe'), { headers: headers() });
  const trace = await validateZeroRowResponse(response, observed.getTrace());
  assert.equal(trace?.outcome, 'invalid_response');
  noSecretOrRawError(trace);
});

test('invalid target and unsafe headers are rejected before egress', async () => {
  let calls = 0;
  const observed = createDiagnosticFetch({
    phase: 'zero_row_probe',
    deadlineAt: Date.now() + 1_000,
    expectedHost: host,
    requestFactory: requestFactoryFor(() => { calls += 1; }),
  });
  await assert.rejects(observed.fetcher(`https://${leak}@${host}/rest/v1/users?select=id&limit=0`, { headers: headers() }));
  assert.equal(calls, 0);
  assert.equal(observed.getTrace()?.outcome, 'invalid_config');
  noSecretOrRawError(observed.getTrace());
});

test('separate concurrent diagnostic fetchers cannot cross-contaminate request evidence', async () => {
  const success = createDiagnosticFetch({
    phase: 'zero_row_probe',
    deadlineAt: Date.now() + 1_000,
    requestFactory: requestFactoryFor(responseScenario({ status: 200, body: '[]' })),
    expectedHost: host,
  });
  const slow = createDiagnosticFetch({
    phase: 'admin_authorization',
    deadlineAt: Date.now() + 40,
    requestTimeoutMs: 20,
    requestFactory: requestFactoryFor(request => normalHandshakes(request)),
    expectedHost: host,
  });
  const [successResult, slowResult] = await Promise.allSettled([
    success.fetcher(queryFor('zero_row_probe'), { headers: headers() }),
    slow.fetcher(queryFor('admin_authorization'), { headers: headers() }),
  ]);
  assert.equal(successResult.status, 'fulfilled');
  assert.equal(slowResult.status, 'rejected');
  assert.equal(success.getTrace()?.phase, 'zero_row_probe');
  assert.equal(success.getTrace()?.outcome, 'success');
  assert.equal(slow.getTrace()?.phase, 'admin_authorization');
  assert.equal(slow.getTrace()?.outcome, 'timeout');
  assert.notEqual(success.getTrace()?.traceId, slow.getTrace()?.traceId);
});
