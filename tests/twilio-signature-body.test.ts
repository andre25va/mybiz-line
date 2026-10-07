import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { NextRequest } from 'next/server';
import { POST as twimlPost } from '../app/api/twiml/route';

const TEST_AUTH_TOKEN = 'test-only-twilio-auth-token';

type FormFields = Record<string, string>;

function signedRequest(url: string, fields: FormFields, signatureOverride?: string): NextRequest {
  const signingString = url + Object.entries(fields)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}${value}`)
    .join('');
  const signature = createHmac('sha1', TEST_AUTH_TOKEN).update(signingString).digest('base64');
  const body = new URLSearchParams(fields);
  return new NextRequest(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-twilio-signature': signatureOverride ?? signature,
    },
    body: body.toString(),
  });
}

test('valid Twilio signature leaves the original TwiML form body parseable', async () => {
  const previousToken = process.env.TWILIO_AUTH_TOKEN;
  process.env.TWILIO_AUTH_TOKEN = TEST_AUTH_TOKEN;
  try {
    const url = 'https://mybiz-line.vercel.app/api/twiml';
    const response = await twimlPost(signedRequest(url, { To: '+17085069000' }));
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /text\/xml/);
    assert.match(await response.text(), /<Number>\+17085069000<\/Number>/);
  } finally {
    if (previousToken === undefined) delete process.env.TWILIO_AUTH_TOKEN;
    else process.env.TWILIO_AUTH_TOKEN = previousToken;
  }
});

test('invalid Twilio signature is still rejected by the TwiML handler', async () => {
  const previousToken = process.env.TWILIO_AUTH_TOKEN;
  process.env.TWILIO_AUTH_TOKEN = TEST_AUTH_TOKEN;
  try {
    const url = 'https://mybiz-line.vercel.app/api/twiml';
    const response = await twimlPost(signedRequest(url, { To: '+17085069000' }, 'invalid-test-signature'));
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: 'Forbidden' });
  } finally {
    if (previousToken === undefined) delete process.env.TWILIO_AUTH_TOKEN;
    else process.env.TWILIO_AUTH_TOKEN = previousToken;
  }
});

test('verifies a cloned platform Request directly and preserves the original body', async () => {
  const previousToken = process.env.TWILIO_AUTH_TOKEN;
  process.env.TWILIO_AUTH_TOKEN = TEST_AUTH_TOKEN;
  try {
    const url = 'https://mybiz-line.vercel.app/api/twiml';
    const syntheticTo = '+15555550199';
    const signature = createHmac('sha1', TEST_AUTH_TOKEN)
      .update(`${url}To${syntheticTo}`)
      .digest('base64');

    // This Request-shaped clone has the Request prototype but not this process's
    // private #state brand, modeling the cross-runtime Request seen on Vercel.
    // Re-wrapping it with `new NextRequest(clone)` throws before verification.
    const clonedPlatformRequest = Object.create(Request.prototype) as Request;
    Object.defineProperties(clonedPlatformRequest, {
      url: { value: url },
      headers: {
        value: new Headers({
          'content-type': 'application/x-www-form-urlencoded',
          'x-twilio-signature': signature,
        }),
      },
      formData: {
        value: async () => {
          const form = new FormData();
          form.set('To', syntheticTo);
          return form;
        },
      },
    });

    const originalRequest = {
      url,
      clone: () => clonedPlatformRequest,
      formData: async () => {
        const form = new FormData();
        form.set('To', syntheticTo);
        return form;
      },
    } as unknown as NextRequest;

    const response = await twimlPost(originalRequest);
    assert.equal(response.status, 200);
    assert.ok((await response.text()).includes(`<Number>${syntheticTo}</Number>`));
  } finally {
    if (previousToken === undefined) delete process.env.TWILIO_AUTH_TOKEN;
    else process.env.TWILIO_AUTH_TOKEN = previousToken;
  }
});
