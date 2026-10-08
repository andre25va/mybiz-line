import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { NextRequest } from 'next/server';

const contactId = '11111111-1111-4111-8111-111111111111';
const grokKey = 'test-only-grok-key';
let PATCH: (request: NextRequest) => Promise<Response>;
let originalFetch: typeof fetch;
let fetchCalls: Array<{ url: string; init?: RequestInit }> = [];

before(async () => {
  process.env.SUPABASE_URL = 'https://supabase.mock.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-placeholder';
  process.env.MYBIZ_API_KEY = grokKey;
  ({ PATCH } = await import('../app/api/grok/contacts/route'));
});

beforeEach(() => {
  fetchCalls = [];
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    fetchCalls.push({ url: String(input), init });
    throw new Error('Unexpected database request');
  }) as typeof fetch;
});

after(() => { globalThis.fetch = originalFetch; });

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function request(body: string, authorization = `Bearer ${grokKey}`) {
  return new NextRequest('http://localhost/api/grok/contacts', {
    method: 'PATCH',
    headers: { authorization, 'content-type': 'application/json' },
    body,
  });
}

function requestBody(call: { init?: RequestInit }) {
  return JSON.parse(String(call.init?.body));
}

function setResponses(...responses: Response[]) {
  let index = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    fetchCalls.push({ url: String(input), init });
    const next = responses[index++];
    if (!next) throw new Error('Unexpected database request');
    return next;
  }) as typeof fetch;
}

test('rejects invalid bearer auth without accessing the database', async () => {
  const result = await PATCH(request(JSON.stringify({ phone: '7609842145', name: 'Yolanda Rustad' }), 'Bearer wrong'));
  assert.equal(result.status, 401);
  assert.equal(fetchCalls.length, 0);
});

test('rejects malformed JSON, non-object payloads, and missing selector or updates', async () => {
  assert.equal((await PATCH(request('{'))).status, 400);
  assert.equal((await PATCH(request('[]'))).status, 400);
  assert.equal((await PATCH(request(JSON.stringify({ name: 'Yolanda Rustad' })))).status, 400);
  assert.equal((await PATCH(request(JSON.stringify({ phone: '7609842145' })))).status, 400);
  assert.equal(fetchCalls.length, 0);
});

test('updates only allowlisted fields and preserves phone as the legacy lookup key', async () => {
  const saved = {
    id: contactId,
    name: 'Yolanda Rustad',
    phone: '+17609842145',
    email: 'yolanda@example.test',
    address: 'Palm Desert',
    notes: 'Existing notes',
    business: 'myredeal',
    tags: ['Realtor'],
    deal_tag: 'Buyer',
    status: 'lead',
  };
  setResponses(response([{ id: contactId }]), response([saved]));
  const result = await PATCH(request(JSON.stringify({
    phone: '7609842145',
    name: 'Yolanda Rustad',
    email: 'yolanda@example.test',
    address: 'Palm Desert',
    notes: 'Existing notes',
    business: 'myredeal',
    tags: ['Realtor'],
    deal_tag: 'Buyer',
    status: 'lead',
    id: '22222222-2222-4222-8222-222222222222',
    user_id: '33333333-3333-4333-8333-333333333333',
    updated_at: '2099-01-01T00:00:00.000Z',
    created_at: '2099-01-01T00:00:00.000Z',
    random_column: 'must not be sent',
  })));

  assert.equal(result.status, 200);
  const resultBody = await result.json();
  assert.equal(resultBody.success, true);
  assert.deepEqual(resultBody.contact, saved);
  assert.equal(fetchCalls.length, 2);
  const lookupUrl = new URL(fetchCalls[0].url);
  assert.equal(lookupUrl.searchParams.get('phone'), 'ilike.*7609842145*');
  assert.equal(lookupUrl.searchParams.get('select'), 'id');
  assert.equal(lookupUrl.searchParams.get('limit'), '2');
  const updateUrl = new URL(fetchCalls[1].url);
  assert.equal(updateUrl.searchParams.get('id'), `eq.${contactId}`);
  assert.deepEqual(requestBody(fetchCalls[1]), {
    name: 'Yolanda Rustad',
    email: 'yolanda@example.test',
    address: 'Palm Desert',
    notes: 'Existing notes',
    business: 'myredeal',
    tags: ['Realtor'],
    deal_tag: 'Buyer',
    status: 'lead',
  });
  assert.equal('updated_at' in requestBody(fetchCalls[1]), false);
  assert.equal('id' in requestBody(fetchCalls[1]), false);
  assert.equal('user_id' in requestBody(fetchCalls[1]), false);
});

test('an explicit lookup_phone allows normalized US and E.164 phone updates', async () => {
  setResponses(
    response([{ id: contactId }]), response([{ id: contactId, phone: '+18165357923' }]),
    response([{ id: contactId }]), response([{ id: contactId, phone: '+442079460958' }]),
  );
  const us = await PATCH(request(JSON.stringify({ lookup_phone: '7609842145', phone: '8165357923' })));
  assert.equal(us.status, 200);
  assert.deepEqual(requestBody(fetchCalls[1]), { phone: '+18165357923' });

  const intl = await PATCH(request(JSON.stringify({ lookup_phone: '7609842145', phone: '+44 20 7946 0958' })));
  assert.equal(intl.status, 200);
  assert.deepEqual(requestBody(fetchCalls[3]), { phone: '+442079460958' });
});

test('rejects an invalid phone update before any database request', async () => {
  const result = await PATCH(request(JSON.stringify({ lookup_phone: '7609842145', phone: '442079460958' })));
  assert.equal(result.status, 400);
  assert.equal(fetchCalls.length, 0);
});

test('fails closed for ambiguous phone matches without updating either contact', async () => {
  setResponses(response([{ id: contactId }, { id: '22222222-2222-4222-8222-222222222222' }]));
  const result = await PATCH(request(JSON.stringify({ phone: '7609842145', name: 'Yolanda Rustad' })));
  assert.equal(result.status, 409);
  assert.equal(fetchCalls.length, 1);
});

test('returns not found when lookup or update affects zero rows', async () => {
  setResponses(response([]));
  const lookupMiss = await PATCH(request(JSON.stringify({ phone: '7609842145', name: 'Yolanda Rustad' })));
  assert.equal(lookupMiss.status, 404);
  assert.equal(fetchCalls.length, 1);

  fetchCalls = [];
  setResponses(response([{ id: contactId }]), response([]));
  const updateMiss = await PATCH(request(JSON.stringify({ phone: '7609842145', name: 'Yolanda Rustad' })));
  assert.equal(updateMiss.status, 404);
  assert.equal(fetchCalls.length, 2);
});

test('returns a non-200 provider failure with only a safe provider code', async () => {
  setResponses(
    response([{ id: contactId }]),
    response({ code: '42703', message: 'updated_at phone 7609842145 and private@example.test' }, 400),
  );
  const logMessages: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => { logMessages.push(args.map(String).join(' ')); };
  try {
    const result = await PATCH(request(JSON.stringify({ phone: '7609842145', name: 'Yolanda Rustad' })));
    assert.equal(result.status, 502);
    const body = await result.json();
    assert.equal(body.error, 'Failed to update contact');
    assert.equal(body.providerCode, '42703');
    assert.equal(JSON.stringify(body).includes('private@example.test'), false);
    assert.equal(JSON.stringify(body).includes('7609842145'), false);
    assert.equal(logMessages.some((message) => message.includes('private@example.test') || message.includes('7609842145')), false);
  } finally {
    console.error = originalError;
  }
});

test('returns a non-200 response for network failure without leaking provider details', async () => {
  fetchCalls = [];
  let call = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    fetchCalls.push({ url: String(input), init });
    if (call++ === 0) return response([{ id: contactId }]);
    throw new Error('https://private.supabase.invalid?token=do-not-expose');
  }) as typeof fetch;
  const result = await PATCH(request(JSON.stringify({ phone: '7609842145', name: 'Yolanda Rustad' })));
  assert.equal(result.status, 503);
  const body = await result.json();
  assert.equal(body.error, 'Contact database is unavailable');
  assert.equal(JSON.stringify(body).includes('private.supabase.invalid'), false);
  assert.equal(JSON.stringify(body).includes('token'), false);
});
