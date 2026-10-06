/**
 * POST /api/knowledge/sms-ingest
 * Called by sms-inbound edge function when MMS is received with KB: prefix
 * Downloads the MMS attachment, extracts text, stores in knowledge base
 */
import { NextRequest, NextResponse } from 'next/server';
import { storeKnowledge } from '@/lib/knowledge';

const INGEST_SECRET = process.env.KB_INGEST_SECRET!;
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;
const TWILIO_PHONE = process.env.TWILIO_PHONE_NUMBER!;

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-ingest-secret');
  if (!secret || secret !== INGEST_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    // Expected: { userId, mediaUrl, mediaType, from }
    const { userId, mediaUrl, mediaType, from } = body;

    if (!userId || !mediaUrl) {
      return NextResponse.json({ error: 'userId and mediaUrl required' }, { status: 400 });
    }

    // Download the MMS attachment (PDF) with Twilio auth
    const mediaRes = await fetch(mediaUrl, {
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64'),
      },
    });
    if (!mediaRes.ok) throw new Error(`Failed to fetch media: ${mediaRes.status}`);

    let text: string;
    let filename: string;

    if (mediaType?.includes('pdf')) {
      const buffer = Buffer.from(await mediaRes.arrayBuffer());
      const pdfParse = (await import('pdf-parse')).default;
      const result = await pdfParse(buffer);
      text = result.text;
      filename = `sms-upload-${Date.now()}.pdf`;
    } else {
      // Plain text attachment
      text = await mediaRes.text();
      filename = `sms-upload-${Date.now()}.txt`;
    }

    if (!text.trim()) {
      return NextResponse.json({ error: 'No readable text in attachment' }, { status: 422 });
    }

    const { docId, chunkCount } = await storeKnowledge({
      userId,
      filename,
      text,
      source: 'sms',
    });

    // Confirm back via SMS
    await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        From: TWILIO_PHONE,
        To: from,
        Body: `✅ Knowledge base updated: "${filename}" added (${chunkCount} chunks indexed).`,
      }),
    });

    return NextResponse.json({ success: true, docId, chunkCount });
  } catch (err: any) {
    console.error('[knowledge/sms-ingest]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
