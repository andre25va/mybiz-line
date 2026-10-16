import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AUTH_REQUEST_TIMEOUT_MS,
  AuthRequestError,
  postAuthRequest,
} from '../lib/auth-request';

test('login requests POST JSON without caching and return status only', async () => {
  let captured: { url: string; init?: RequestInit } | undefined;
  const result = await postAuthRequest('/api/auth/send-otp', { probe: 'test' }, 1_000, async (input, init) => {
    captured = { url: String(input), init };
    return new Response('private provider details', { status: 403 });
  });

  assert.deepEqual(result, { ok: false, status: 403 });
  assert.equal(captured?.url, '/api/auth/send-otp');
  assert.equal(captured?.init?.method, 'POST');
  assert.equal(captured?.init?.cache, 'no-store');
  assert.equal(captured?.init?.headers && new Headers(captured.init.headers).get('content-type'), 'application/json');
  assert.equal(captured?.init?.body, JSON.stringify({ probe: 'test' }));
  assert.ok(captured?.init?.signal instanceof AbortSignal);
  assert.equal(JSON.stringify(result).includes('private provider details'), false);
});

test('only the existing ok:true contract counts as successful', async () => {
  const valid = await postAuthRequest('/api/auth/send-otp', {}, 1_000, async () =>
    new Response(JSON.stringify({ ok: true }), { status: 200 }));
  assert.deepEqual(valid, { ok: true, status: 200 });

  for (const response of [
    new Response('{}', { status: 200 }),
    new Response('not json', { status: 200 }),
  ]) {
    await assert.rejects(
      postAuthRequest('/api/auth/send-otp', {}, 1_000, async () => response),
      error => error instanceof AuthRequestError && error.kind === 'invalid-response',
    );
  }
});

test('network failures become a redacted typed login error', async () => {
  await assert.rejects(
    postAuthRequest('/api/auth/send-otp', {}, 1_000, async () => {
      throw new Error('private upstream detail');
    }),
    error => error instanceof AuthRequestError
      && error.kind === 'network'
      && !error.message.includes('private upstream detail'),
  );
});

test('timeout aborts the request and rejects even when the fetch implementation stalls', async () => {
  const signals: AbortSignal[] = [];
  const stalledFetch: typeof fetch = async (_input, init) => {
    const signal = init?.signal as AbortSignal;
    signals.push(signal);
    return new Promise<Response>((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    });
  };

  await assert.rejects(
    postAuthRequest('/api/auth/send-otp', {}, 10, stalledFetch),
    error => error instanceof AuthRequestError && error.kind === 'timeout',
  );
  assert.equal(signals.length, 1);
  assert.equal(signals[0].aborted, true);
  assert.equal(AUTH_REQUEST_TIMEOUT_MS, 35_000);
});

test('invalid timeout values fail before making a request', async () => {
  let called = false;
  const fetchImpl: typeof fetch = async () => {
    called = true;
    return new Response(null, { status: 200 });
  };
  await assert.rejects(postAuthRequest('/api/auth/send-otp', {}, 0, fetchImpl), RangeError);
  assert.equal(called, false);
});
