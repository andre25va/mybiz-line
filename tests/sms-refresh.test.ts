import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  createSmsRefreshController,
  fetchSmsJson,
  isNearBottom,
  shouldFollowNewSmsMessages,
  SMS_NO_STORE_HEADERS,
  SMS_REFRESH_INTERVAL_MS,
} from '../lib/sms-refresh';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test('inbox endpoint opts out of Next and CDN caching and returns no-store headers', async () => {
  const route = await readFile(new URL('../app/api/sms/inbox/route.ts', import.meta.url), 'utf8');
  assert.match(route, /export const dynamic = 'force-dynamic'/);
  assert.match(route, /export const revalidate = 0/);
  assert.match(route, /NextResponse\.json\(convos, \{ headers: SMS_NO_STORE_HEADERS \}\)/);
  assert.match(route, /status: 500, headers: SMS_NO_STORE_HEADERS/);

  const headers = new Headers(SMS_NO_STORE_HEADERS);
  assert.match(headers.get('cache-control') || '', /no-store/i);
  assert.match(headers.get('cdn-cache-control') || '', /no-store/i);
  assert.match(headers.get('vercel-cdn-cache-control') || '', /no-store/i);
  assert.equal(headers.get('pragma'), 'no-cache');
  assert.equal(headers.get('expires'), '0');
});

test('client JSON requests always bypass browser caches and surface HTTP failures', async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; cache?: RequestCache; signal?: AbortSignal }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), cache: init?.cache, signal: init?.signal as AbortSignal });
    return new Response(JSON.stringify([{ sid: 'SM-new' }]), { status: 200 });
  }) as typeof fetch;
  try {
    const inboxData = await fetchSmsJson<Array<{ sid: string }>>('/api/sms/inbox', new AbortController().signal);
    const threadData = await fetchSmsJson<Array<{ sid: string }>>('/api/sms?number=%2B13125550000', new AbortController().signal);
    assert.deepEqual(inboxData, [{ sid: 'SM-new' }]);
    assert.deepEqual(threadData, [{ sid: 'SM-new' }]);
    assert.deepEqual(requests.map(request => request.url), [
      '/api/sms/inbox',
      '/api/sms?number=%2B13125550000',
    ]);
    assert.deepEqual(requests.map(request => request.cache), ['no-store', 'no-store']);
    assert.equal(requests.every(request => request.signal instanceof AbortSignal), true);

    globalThis.fetch = (async () => new Response('{}', { status: 503 })) as typeof fetch;
    await assert.rejects(fetchSmsJson('/api/sms/inbox', new AbortController().signal), /503/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('inbox and open-thread refreshes expose messages received after the first response', async () => {
  for (const url of ['/api/sms/inbox', '/api/sms?number=%2B13125550000']) {
    const responseQueue = [
      new Response(JSON.stringify([{ sid: 'SM-old' }]), { status: 200 }),
      new Response(JSON.stringify([{ sid: 'SM-old' }, { sid: 'SM-inbound' }]), { status: 200 }),
    ];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => responseQueue.shift()!) as typeof fetch;
    try {
      const observed: string[][] = [];
      const controller = createSmsRefreshController(
        signal => fetchSmsJson<Array<{ sid: string }>>(url, signal),
        messages => observed.push(messages.map(message => message.sid)),
      );
      await controller.refresh();
      await controller.refresh();
      assert.deepEqual(observed, [['SM-old'], ['SM-old', 'SM-inbound']]);
      controller.dispose();
    } finally {
      globalThis.fetch = originalFetch;
    }
  }
  assert.equal(SMS_REFRESH_INTERVAL_MS, 5_000);
});

test('refreshes do not overlap and coalesce busy triggers into one trailing send/focus refresh', async () => {
  const first = deferred<string[]>();
  let calls = 0;
  const observed: string[][] = [];
  const controller = createSmsRefreshController(
    async () => {
      calls += 1;
      return calls === 1 ? first.promise : ['new inbound'];
    },
    data => observed.push(data),
  );

  const pollingRequest = controller.refresh();
  const manualOrSendRequest = controller.refresh();
  await Promise.resolve();
  assert.equal(calls, 1);
  first.resolve(['initial']);
  await pollingRequest;
  await manualOrSendRequest;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 2);
  assert.deepEqual(observed, [['initial'], ['new inbound']]);
  controller.dispose();
});

test('thread switch and cleanup abort or discard stale responses', async () => {
  const oldResponse = deferred<string[]>();
  const oldSignals: AbortSignal[] = [];
  const oldUpdates: string[][] = [];
  const oldThread = createSmsRefreshController(
    signal => { oldSignals.push(signal); return oldResponse.promise; },
    data => oldUpdates.push(data),
  );
  const oldRequest = oldThread.refresh();
  await Promise.resolve();

  const newUpdates: string[][] = [];
  const newThread = createSmsRefreshController(
    async () => ['new contact message'],
    data => newUpdates.push(data),
  );
  oldThread.dispose();
  assert.equal(oldSignals[0]?.aborted, true);
  await newThread.refresh();
  oldResponse.resolve(['stale previous contact']);
  await oldRequest;

  assert.deepEqual(oldUpdates, []);
  assert.deepEqual(newUpdates, [['new contact message']]);
  newThread.dispose();
});

test('failed refresh recovers on the next bounded poll without replacing fresh messages', async () => {
  let calls = 0;
  const errors: unknown[] = [];
  const observed: string[][] = [];
  const controller = createSmsRefreshController(
    async () => {
      calls += 1;
      if (calls === 1) throw new Error('temporary provider error');
      return ['still available after retry'];
    },
    data => observed.push(data),
    undefined,
    error => errors.push(error),
  );

  await controller.refresh();
  await controller.refresh();
  assert.equal(errors.length, 1);
  assert.deepEqual(observed, [['still available after retry']]);
  controller.dispose();
});

test('unsent draft remains independent of incoming-message refreshes and send still refreshes', async () => {
  const thread = await readFile(new URL('../components/SMSThread.tsx', import.meta.url), 'utf8');
  const refreshEffect = thread.slice(thread.indexOf('let hasLoaded = false;'), thread.indexOf('  }, [number]);'));
  const sendHandler = thread.slice(thread.indexOf('  const send = async () => {'), thread.indexOf('  const detectEvent = async () => {'));
  assert.ok(refreshEffect.length > 0);
  assert.doesNotMatch(refreshEffect, /setText\(/);
  assert.match(thread, /value=\{text\}/);
  assert.match(sendHandler, /fetch\('\/api\/sms\/send'/);
  assert.match(sendHandler, /setText\(''\)/);
  assert.match(sendHandler, /load\(\)/);
});

test('new messages follow the bottom only for initial load or while the reader is near bottom', () => {
  assert.equal(isNearBottom({ scrollHeight: 1_000, scrollTop: 820, clientHeight: 100 }), true);
  assert.equal(isNearBottom({ scrollHeight: 1_000, scrollTop: 700, clientHeight: 100 }), false);
  assert.equal(isNearBottom(null), true);

  const current = [{ sid: 'SM-1' }];
  assert.equal(shouldFollowNewSmsMessages(current, current, false), false);
  assert.equal(shouldFollowNewSmsMessages(current, [{ sid: 'SM-1', }, { sid: 'SM-2' }], true), true);
  assert.equal(shouldFollowNewSmsMessages(current, [{ sid: 'SM-1' }, { sid: 'SM-2' }], false), false);
  assert.equal(shouldFollowNewSmsMessages([], current, false, true), true);
});
