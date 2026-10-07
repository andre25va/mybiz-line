import { NextResponse } from 'next/server';
import twilio from 'twilio';
import { readVoiceTokenCredentials } from '@/lib/twilio/config';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const TOKEN_TTL_SECONDS = 60 * 60;
const NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store, no-cache, max-age=0, must-revalidate',
  'CDN-Cache-Control': 'no-store',
  'Vercel-CDN-Cache-Control': 'no-store',
  Pragma: 'no-cache',
  Expires: '0',
};

function tokenResponse(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
}

export async function GET() {
  const credentials = readVoiceTokenCredentials();
  if (!credentials) {
    return tokenResponse({ error: 'Phone token service is unavailable.' }, 503);
  }
  const { accountSid, apiKey, apiSecret, twimlAppSid } = credentials;

  try {
    const { AccessToken } = twilio.jwt;
    const { VoiceGrant } = AccessToken;
    const token = new AccessToken(accountSid, apiKey, apiSecret, {
      identity: 'andre',
      ttl: TOKEN_TTL_SECONDS,
    });

    token.addGrant(new VoiceGrant({ outgoingApplicationSid: twimlAppSid, incomingAllow: true }));
    const jwt = token.toJwt();
    const expiresAt = new Date(Date.now() + TOKEN_TTL_SECONDS * 1000).toISOString();

    return tokenResponse({ token: jwt, expiresAt });
  } catch {
    // Do not expose Twilio credentials, JWTs, or SDK exception details in an HTTP response.
    return tokenResponse({ error: 'Unable to issue a phone token.' }, 500);
  }
}
