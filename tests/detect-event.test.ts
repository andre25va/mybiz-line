import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { NextRequest } from 'next/server';
import { runEventDetection, type DetectedEvent } from '../lib/detect-event';
import { POST } from '../app/api/ai-detect/route';

const event: DetectedEvent = {
  detected: true,
  title: 'Meeting',
  date: '2026-11-10',
  time: '15:30',
  description: 'Discuss the project.',
};
const previousFetch = globalThis.fetch;
const previousOpenAiKey = process.env.OPENAI_API_KEY;
const providerCalls: Array<{ url: string; init?: RequestInit }> = [];

beforeEach(() => {
  providerCalls.length = 0;
  process.env.OPENAI_API_KEY = 'test-key-not-a-real-secret';
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    providerCalls.push({ url: String(input), init });
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(event) } }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
});

after(() => {
  globalThis.fetch = previousFetch;
  if (previousOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = previousOpenAiKey;
});

function apiRequest(body: unknown) {
  return new NextRequest('http://localhost/api/ai-detect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function runClient(
  fetcher: typeof fetch,
  text = 'Them: Can we meet tomorrow at 3:30 PM?',
) {
  const state = {
    loading: [] as boolean[],
    results: [] as Array<DetectedEvent | null>,
    errors: [] as Array<string | null>,
  };
  await runEventDetection(text, {
    fetcher,
    onLoadingChange: value => state.loading.push(value),
    onResult: value => state.results.push(value),
    onError: value => state.errors.push(value),
  });
  return state;
}

test('UI request targets existing route, validates result contract, and performs no calendar/SMS/task action', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const state = await runClient((async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify(event), { status: 200 });
  }) as typeof fetch);

  assert.deepEqual(state.results, [event]);
  assert.deepEqual(state.errors, [null]);
  assert.deepEqual(state.loading, [true, false]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/ai-detect');
  assert.equal(calls[0].init?.method, 'POST');
  assert.equal(calls[0].init?.headers && (calls[0].init?.headers as Record<string, string>)['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { text: 'Them: Can we meet tomorrow at 3:30 PM?' });
});

test('UI shows clear server error and resets loading on non-2xx', async () => {
  const state = await runClient((async () => new Response(JSON.stringify({ error: { code: 'provider_error' } }), { status: 502 })) as typeof fetch);
  assert.deepEqual(state.loading, [true, false]);
  assert.deepEqual(state.results, [null]);
  assert.match(String(state.errors.at(-1)), /service is unavailable/i);
});

test('UI handles malformed JSON and malformed event shape as errors and resets loading', async () => {
  const malformedJson = await runClient((async () => new Response('{', { status: 200 })) as typeof fetch);
  assert.deepEqual(malformedJson.loading, [true, false]);
  assert.match(String(malformedJson.errors.at(-1)), /unreadable response/i);

  const malformedContract = await runClient((async () => new Response(JSON.stringify({ ...event, time: '29:70' }), { status: 200 })) as typeof fetch);
  assert.deepEqual(malformedContract.loading, [true, false]);
  assert.match(String(malformedContract.errors.at(-1)), /invalid response/i);
});

test('UI handles network rejection and always resets loading', async () => {
  const state = await runClient((async () => { throw new Error('offline'); }) as typeof fetch);
  assert.deepEqual(state.loading, [true, false]);
  assert.deepEqual(state.results, [null]);
  assert.match(String(state.errors.at(-1)), /connection/i);
});

test('no-event response is a valid visible result, not an error', async () => {
  const noEvent: DetectedEvent = {
    detected: false,
    title: '',
    date: null,
    time: null,
    description: 'No scheduling intent found.',
  };
  const state = await runClient((async () => new Response(JSON.stringify(noEvent), { status: 200 })) as typeof fetch);
  assert.deepEqual(state.results, [noEvent]);
  assert.deepEqual(state.errors, [null]);
  assert.deepEqual(state.loading, [true, false]);
});

test('API rejects malformed request JSON/schema without calling provider', async () => {
  const badJson = new NextRequest('http://localhost/api/ai-detect', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{',
  });
  const invalidSchema = await POST(apiRequest({ text: '  ' }));
  const response = await POST(badJson);
  assert.equal(invalidSchema.status, 400);
  assert.equal(response.status, 400);
  assert.equal(providerCalls.length, 0);
});

test('API returns explicit unavailable status when OpenAI key is missing', async () => {
  delete process.env.OPENAI_API_KEY;
  const response = await POST(apiRequest({ text: 'Find an appointment.' }));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: { code: 'not_configured' } });
  assert.equal(providerCalls.length, 0);
});

test('API returns validated event result from existing gpt-4o-mini route', async () => {
  const response = await POST(apiRequest({ text: 'Them: Can we meet tomorrow?' }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), event);
  assert.equal(providerCalls.length, 1);
  assert.equal(providerCalls[0].url, 'https://api.openai.com/v1/chat/completions');
  const providerBody = JSON.parse(String(providerCalls[0].init?.body));
  assert.equal(providerBody.model, 'gpt-4o-mini');
});

test('API reports upstream non-2xx without leaking provider body', async () => {
  globalThis.fetch = (async () => new Response('provider detail with private content', { status: 429 })) as typeof fetch;
  const response = await POST(apiRequest({ text: 'Meeting?' }));
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: { code: 'provider_error' } });
});

test('API rejects malformed upstream JSON and invalid output contract', async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: '{' } }] }), { status: 200 })) as typeof fetch;
  const invalidJson = await POST(apiRequest({ text: 'Meeting?' }));
  assert.equal(invalidJson.status, 502);

  globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ...event, date: '2026-02-30' }) } }] }), { status: 200 })) as typeof fetch;
  const invalidEvent = await POST(apiRequest({ text: 'Meeting?' }));
  assert.equal(invalidEvent.status, 502);
  assert.deepEqual(await invalidEvent.json(), { error: { code: 'invalid_provider_response' } });
});

test('API maps provider network failure to safe upstream error', async () => {
  globalThis.fetch = (async () => { throw new Error('offline with private diagnostic'); }) as typeof fetch;
  const response = await POST(apiRequest({ text: 'Meeting?' }));
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: { code: 'provider_error' } });
});

test('API accepts a no-event result using the exact UI result contract', async () => {
  const noEvent: DetectedEvent = { detected: false, title: '', date: null, time: null, description: '' };
  globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(noEvent) } }] }), { status: 200 })) as typeof fetch;
  const response = await POST(apiRequest({ text: 'Thanks, talk soon.' }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), noEvent);
});
