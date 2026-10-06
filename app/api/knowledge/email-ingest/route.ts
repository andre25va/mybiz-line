/**
 * POST /api/knowledge/email-ingest
 * Receives forwarded email with PDF attachment (subject starts with KB:)
 * Called by Gmail webhook or n8n automation
 * Auth: internal secret header
 */
import { NextRequest, NextResponse } from 'next/server';
import { storeKnowledge } from '@/lib/knowledge';

const INGEST_SECRET = process.env.KB_INGEST_SECRET!;
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;
const TWILIO_PHONE = process.env.TWILIO_PHONE_NUMBER!;
const ADMIN_PHONE = process.env.TWILIO_FALLBACK_NUMBER!; // your cell to confirm

export async function POST(req: NextRequest) {
  // Verify internal secret
  const secret = req.headers.get('x-ingest-secret');
  if (!secret || secret !== INGEST_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    // Expected: { userId, filename, text, from }
    const { userId, filename, text, from } = body;

    if (!userId || !text || !filename) {
      return NextResponse.json({ error: 'userId, filename, and text are required' }, { status: 400 });
    }

    const { docId, chunkCount } = await storeKnowledge({
      userId,
      filename,
      text,
      source: 'email',
    });

    // Send confirmation SMS
    await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        From: TWILIO_PHONE,
        To: ADMIN_PHONE,
        Body: `✅ Knowledge base updated: "${filename}" added (${chunkCount} chunks indexed).`,
      }),
    });

    return NextResponse.json({ success: true, docId, chunkCount });
  } catch (err: any) {
    console.error('[knowledge/email-ingest]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
