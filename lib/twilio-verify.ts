import { NextResponse } from 'next/server';
import crypto from 'crypto';

/**
 * Validates that a POST request genuinely came from Twilio.
 * Returns a 403 response if invalid, null if valid.
 */
export async function requireTwilioSignature(req: Request): Promise<NextResponse | null> {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) return null; // skip in dev if not configured

  const signature = req.headers.get('x-twilio-signature') || '';
  const url = req.url;

  // Reconstruct the signed string: URL + sorted POST params
  const formData = await req.formData();
  const params: Record<string, string> = {};
  formData.forEach((v, k) => { params[k] = v as string; });

  const sortedKeys = Object.keys(params).sort();
  const signingStr = url + sortedKeys.map(k => k + params[k]).join('');

  const expected = crypto
    .createHmac('sha1', authToken)
    .update(signingStr)
    .digest('base64');

  if (signature !== expected) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return null;
}
