import assert from 'node:assert/strict';
import test from 'node:test';
import twilio from 'twilio';
import { isValidTwilioSignature, webhookUrlCandidates } from './twilio-webhook';

test('validates the Twilio request signature and rejects a bad one', () => {
  const token = 'test-auth-token';
  const url = 'https://mybiz-line.vercel.app/api/sms/inbound';
  const params = { From: '+13129989898', To: '+14647333257', Body: 'New client: Maria Lopez', NumMedia: '0' };
  const signature = twilio.getExpectedTwilioSignature(token, url, params);
  assert.equal(isValidTwilioSignature(token, signature, [url], params), true);
  assert.equal(isValidTwilioSignature(token, 'not-the-signature', [url], params), false);
  assert.equal(isValidTwilioSignature('', signature, [url], params), false);
});

test('includes the production messaging webhook in signature candidates', () => {
  const previous = process.env.TWILIO_SMS_WEBHOOK_URL;
  process.env.TWILIO_SMS_WEBHOOK_URL = 'https://example.test/api/sms/inbound';
  const urls = webhookUrlCandidates(
    {
      headers: { get: (name) => (name === 'host' ? 'mybiz-line.vercel.app' : name === 'x-forwarded-proto' ? 'https' : null) },
      nextUrl: { pathname: '/api/sms/inbound', search: '' },
    },
    'https://mybiz-line.vercel.app/api/sms/inbound',
  );
  process.env.TWILIO_SMS_WEBHOOK_URL = previous;
  assert.equal(urls[0], 'https://example.test/api/sms/inbound');
  assert.ok(urls.includes('https://mybiz-line.vercel.app/api/sms/inbound'));
});
