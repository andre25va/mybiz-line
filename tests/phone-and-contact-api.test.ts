import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { NextRequest } from 'next/server';
import { buildUniquePhoneMap, matchPhone, normalizePhone } from '../lib/contact-phone';

const tenantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const contactId = '11111111-1111-4111-8111-111111111111';
let signSession: (userId: string) => string;
let POST: (request: NextRequest) => Promise<Response>;
let PATCH: (request: NextRequest) => Promise<Response>;
let originalFetch: typeof fetch;
let fetchCalls: Array<{ url: string; init?: RequestInit }> = [];

before(async () => {
  process.env.SESSION_SECRET = 'contact-normalization-test-secret';
  process.env.SUPABASE_URL = 'https://supabase.mock.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-placeholder';
  ({ signSession } = await import('../lib/session'));
  ({ POST, PATCH } = await import('../app/api/contacts/route'));
});

beforeEach(() => {
  fetchCalls = [];
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    fetchCalls.push({ url: String(input), init });
    return new Response(JSON.stringify([{ id: contactId }]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
});

after(() => { globalThis.fetch = originalFetch; });

function authenticatedRequest(url: string, method: string, body: unknown) {
  return new NextRequest(url, {
    method,
    headers: {
      cookie: `mbl_session=${signSession(tenantId)}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

function requestBody(call: { init?: RequestInit }) {
  return JSON.parse(String(call.init?.body));
}

test('normalizes valid US numbers to canonical E.164', () => {
  assert.equal(normalizePhone('8165357923'), '+18165357923');
  assert.equal(normalizePhone('(816) 535-7923'), '+18165357923');
  assert.equal(normalizePhone('1 (816) 535-7923'), '+18165357923');
  assert.equal(normalizePhone('+1 240 418 8899'), '+12404188899');
});

test('preserves valid explicit international E.164 and rejects ambiguous or invalid values', () => {
  assert.equal(normalizePhone('+44 20 7946 0958'), '+442079460958');
  assert.equal(normalizePhone('+81 3 1234 5678'), '+81312345678');
  assert.equal(normalizePhone('442079460958'), null);
  assert.equal(normalizePhone('816535792'), null);
  assert.equal(normalizePhone('28165357923'), null);
  assert.equal(normalizePhone('+999123456789'), null);
  assert.equal(normalizePhone('816-535-7923 ext 2'), null);
  assert.equal(normalizePhone('Call Maggie at 8165357923'), null);
});

test('canonical phone matching resolves formats, but duplicate contacts stay ambiguous', () => {
  const maggie = { name: 'Maggie', phone: '8165357923' };
  const unique = buildUniquePhoneMap([maggie]);
  assert.equal(matchPhone(unique, '+18165357923'), maggie);
  assert.equal(matchPhone(unique, '(816) 535-7923'), maggie);

  const duplicate = buildUniquePhoneMap([maggie, { name: 'Other', phone: '+1 816 535 7923' }]);
  assert.equal(matchPhone(duplicate, '+18165357923'), null);
});

test('POST normalizes phone and binds ownership to the signed-in tenant', async () => {
  const response = await POST(authenticatedRequest('http://localhost/api/contacts', 'POST', {
    id: contactId,
    name: 'Maggie Sanchez',
    phone: '8165357923',
    business: 'myredeal',
    user_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  }));
  assert.equal(response.status, 200);
  assert.equal(fetchCalls.length, 1);
  const body = requestBody(fetchCalls[0]);
  assert.equal(body.phone, '+18165357923');
  assert.equal(body.user_id, tenantId);
  assert.equal('id' in body, false);
});

test('POST rejects invalid phone input before any database request', async () => {
  const response = await POST(authenticatedRequest('http://localhost/api/contacts', 'POST', {
    name: 'Invalid', phone: '816535792',
  }));
  assert.equal(response.status, 400);
  assert.equal(fetchCalls.length, 0);
});

test('PATCH normalizes phone and constrains both query and body to current tenant', async () => {
  const response = await PATCH(authenticatedRequest(`http://localhost/api/contacts?id=${contactId}`, 'PATCH', {
    phone: '(816) 535-7923',
    business: 'myredeal',
  }));
  assert.equal(response.status, 200);
  assert.equal(fetchCalls.length, 1);
  const url = new URL(fetchCalls[0].url);
  assert.equal(url.searchParams.get('id'), `eq.${contactId}`);
  assert.equal(url.searchParams.get('user_id'), `eq.${tenantId}`);
  const body = requestBody(fetchCalls[0]);
  assert.equal(body.phone, '+18165357923');
  assert.equal(body.user_id, tenantId);
});

test('PATCH rejects ownership changes and invalid phones without database requests', async () => {
  const ownership = await PATCH(authenticatedRequest(`http://localhost/api/contacts?id=${contactId}`, 'PATCH', {
    phone: '8165357923', user_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  }));
  assert.equal(ownership.status, 400);
  assert.equal(fetchCalls.length, 0);

  const invalidPhone = await PATCH(authenticatedRequest(`http://localhost/api/contacts?id=${contactId}`, 'PATCH', {
    phone: '12345',
  }));
  assert.equal(invalidPhone.status, 400);
  assert.equal(fetchCalls.length, 0);
});
