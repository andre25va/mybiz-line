import { NextRequest, NextResponse } from 'next/server';
import { processClientIntake } from '@/lib/client-intake';
import { extractLead } from '@/lib/intake-ai';
import { createIntakeDeps } from '@/lib/intake-db';
import { MYBIZ_NUMBER, parseAllowlist } from '@/lib/phone';
import { SMS_WEBHOOK_URL, formParams, isValidTwilioSignature, twimlBody, webhookUrlCandidates } from '@/lib/twilio-webhook';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/** Messaging webhook only. Voice stays on /api/twiml so call forwarding is unchanged. */
export async function POST(req: NextRequest) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) return new NextResponse('Twilio is not configured', { status: 500 });

  const params = formParams(await req.formData());
  const signature = req.headers.get('x-twilio-signature') || '';
  const urls = webhookUrlCandidates(req, SMS_WEBHOOK_URL);
  if (!isValidTwilioSignature(authToken, signature, urls, params)) {
    return new NextResponse('Invalid Twilio signature', { status: 403 });
  }

  const messageSid = params.MessageSid || params.SmsMessageSid || '';
  try {
    const allowlist = parseAllowlist(process.env.CLIENT_INTAKE_ALLOWLIST);
    const result = await processClientIntake(
      {
        messageSid: messageSid || `missing-${crypto.randomUUID()}`,
        from: params.From || '',
        to: params.To || '',
        body: params.Body || '',
        media: collectMedia(params),
      },
      createIntakeDeps({
        allowlist,
        blockedPhones: [...allowlist, process.env.TWILIO_PHONE_NUMBER || MYBIZ_NUMBER],
        readMedia: fetchTwilioMedia,
        extractWithAi: extractLead,
      }),
    );
    return xml(result.reply);
  } catch (err) {
    console.error('client intake failed', messageSid, err instanceof Error ? err.message : err);
    return xml(failureReply(err));
  }
}

function collectMedia(params: Record<string, string>) {
  const count = Number.parseInt(params.NumMedia || '0', 10);
  const media = [];
  const total = Number.isFinite(count) ? Math.min(Math.max(count, 0), 10) : 0;
  for (let i = 0; i < total; i++) {
    const url = params[`MediaUrl${i}`];
    if (!url) continue;
    media.push({ url, contentType: params[`MediaContentType${i}`] || '' });
  }
  return media;
}

async function fetchTwilioMedia(url: string): Promise<{ mime: string; bytes: Buffer }> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) throw new Error('Media fetch failed: Twilio credentials missing');
  const res = await fetch(url, {
    headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}` },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`Media fetch failed (${res.status})`);
  const mime = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  return { mime, bytes: Buffer.from(await res.arrayBuffer()) };
}

function failureReply(err: unknown): string {
  const msg = err instanceof Error ? err.message : '';
  if (/media fetch failed/i.test(msg)) return "I couldn't download that attachment. Try sending it again.";
  if (/Missing AI API key|Intake model is not configured/i.test(msg)) {
    return 'I can save contact cards, but text and screenshots need the AI key configured.';
  }
  if (/Missing SUPABASE/i.test(msg)) return 'Contact storage is not configured yet.';
  if (/biz_intake|biz_contacts|PGRST|schema cache|column/i.test(msg)) {
    return 'I could not save that contact yet. The client-intake database migration still needs to be applied.';
  }
  return 'Something went wrong saving that contact. Try again in a moment.';
}

function xml(message: string | null) {
  return new NextResponse(twimlBody(message), {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  });
}
