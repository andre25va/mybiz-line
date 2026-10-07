import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-check';
import { isTwilioAuthTokenPresent, isVoiceTokenConfigComplete } from '@/lib/twilio/config';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store, no-cache, max-age=0, must-revalidate',
  'CDN-Cache-Control': 'no-store',
  'Vercel-CDN-Cache-Control': 'no-store',
  Pragma: 'no-cache',
  Expires: '0',
};

const PROVIDER_OUTAGE_DETAIL =
  'No official provider status source is checked; an integration failure does not establish a provider outage.';

type UnknownCheck = {
  status: 'unknown';
  observedAt: null;
  ref: null;
  detail: string;
};

function unknownCheck(detail: string): UnknownCheck {
  return { status: 'unknown', observedAt: null, ref: null, detail };
}

function healthResponse(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
}

function denied() {
  return healthResponse({ error: 'Forbidden' }, 403);
}

function unavailable() {
  return healthResponse({ error: 'System health is unavailable.' }, 503);
}

export async function GET(req: NextRequest) {
  const session = requireAuth(req);
  if (session instanceof NextResponse) return healthResponse({ error: 'Unauthorized' }, 401);

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return unavailable();

  const lookupUrl =
    `${supabaseUrl}/rest/v1/users?id=eq.${encodeURIComponent(session.userId)}` +
    '&select=is_admin,is_active&limit=1';

  let lookup: Response;
  try {
    lookup = await fetch(lookupUrl, {
      cache: 'no-store',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Accept: 'application/json',
      },
    });
  } catch {
    return unavailable();
  }

  if (!lookup.ok) return unavailable();

  let rows: unknown;
  try {
    rows = await lookup.json();
  } catch {
    return unavailable();
  }

  if (!Array.isArray(rows)) return unavailable();
  if (rows.length === 0) return denied();

  const row = rows[0];
  // A missing user is an empty array. Null, a primitive, or a nested array is a malformed lookup.
  if (row === null || typeof row !== 'object' || Array.isArray(row)) return unavailable();
  const record = row as { is_admin?: unknown; is_active?: unknown };
  if (record.is_admin !== true || record.is_active !== true) return denied();

  return healthResponse({
    configuration: isVoiceTokenConfigComplete() ? 'complete' : 'incomplete',
    configurationObservedAt: new Date().toISOString(),
    authTokenPresent: isTwilioAuthTokenPresent(),
    checks: {
      tokenIssuance: unknownCheck('Token issuance was not attempted.'),
      signatureVerification: unknownCheck('No recent verification evidence. Auth token presence is not verification.'),
      registration: unknownCheck('Not observable from the admin page.'),
      lastCall: unknownCheck('Call history was not requested.'),
      providerError: unknownCheck('Unavailable.'),
      providerOutage: unknownCheck(PROVIDER_OUTAGE_DETAIL),
      twoWayAudio: unknownCheck('Two-way audio was not observed.'),
    },
  }, 200);
}
