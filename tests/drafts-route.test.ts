import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { NextRequest } from 'next/server';

process.env.SESSION_SECRET = 'phase2-drafts-route-secret';
process.env.SUPABASE_URL = 'https://supabase.mock.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'phase2-drafts-service-key';

let GET: (req: NextRequest) => Promise<Response>;
let signSession: (userId: string) => string;

before(async () => {
  ({ GET } = await import('../app/api/drafts/route'));
  ({ signSession } = await import('../lib/session'));
});

function draftsRequest(query = '') {
  return new NextRequest(`http://localhost/api/drafts${query}`, {
    headers: { cookie: `mbl_session=${signSession('user-1')}` },
  });
}

test('drafts rejects an invalid cursor before querying', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response('[]', { status: 200 });
  }) as typeof fetch;
  try {
    const response = await GET(draftsRequest('?before=not-a-date'));
    assert.equal(response.status, 400);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = original;
  }
});

test('drafts caps the page and returns the next cursor', async () => {
  const original = globalThis.fetch;
  let url = '';
  const rows = Array.from({ length: 51 }, (_, index) => ({
    id: `draft-${index}`,
    from_number: '+15555550100',
    original_message: 'hi',
    draft_text: 'reply',
    created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, 51 - index)).toISOString(),
    status: 'pending',
  }));
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    url = String(input);
    return new Response(JSON.stringify(rows), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  try {
    const response = await GET(draftsRequest('?limit=500'));
    assert.equal(response.status, 200);
    assert.match(url, /\/rest\/v1\/dispatcher_drafts\?/);
    assert.match(url, /limit=51/);
    const body = await response.json();
    assert.equal(body.items.length, 50);
    assert.equal(body.nextCursor, rows[49].created_at);
    assert.equal(JSON.stringify(body).includes('select=*'), false);
  } finally {
    globalThis.fetch = original;
  }
});

test('drafts returns 503 within 6 seconds when the database hangs', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => new Promise((_resolve, reject) => {
    const fail = () => {
      const error = new Error('timeout');
      error.name = 'TimeoutError';
      reject(error);
    };
    if (init?.signal?.aborted) fail();
    else init?.signal?.addEventListener('abort', fail, { once: true });
  })) as typeof fetch;
  const started = Date.now();
  const keepAlive = setInterval(() => {}, 50);
  try {
    const response = await GET(draftsRequest());
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'Drafts temporarily unavailable' });
    assert.ok(Date.now() - started <= 6_000);
  } finally {
    clearInterval(keepAlive);
    globalThis.fetch = original;
  }
});
