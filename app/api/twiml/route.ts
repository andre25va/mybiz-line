import { NextRequest, NextResponse } from 'next/server';
import { requireTwilioSignature } from '@/lib/twilio-verify';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://mybiz-line-git-main-andre25vas-projects.vercel.app';
const MYBIZ_NUMBER = process.env.TWILIO_PHONE_NUMBER || '+14647333257';
const FORWARD_TO = process.env.TWILIO_FALLBACK_NUMBER || '';

export async function POST(req: NextRequest) {
  const invalid = await requireTwilioSignature(req);
  if (invalid) return invalid;

  const formData = await req.formData();
  const to = formData.get('To') as string;

  const isInbound = to === MYBIZ_NUMBER;

  let twiml: string;

  if (!isInbound && to) {
    const recordingStatusUrl = `${APP_URL}/api/calls/recording-status`;
    twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="${MYBIZ_NUMBER}" timeout="30" record="record-from-answer-dual" recordingStatusCallback="${recordingStatusUrl}" recordingStatusCallbackMethod="POST">
    <Number>${to}</Number>
  </Dial>
</Response>`;
  } else {
    const fallbackUrl = `${APP_URL}/api/twiml/fallback`;
    const recordingStatusUrl = `${APP_URL}/api/calls/recording-status`;
    twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="${MYBIZ_NUMBER}" timeout="15" action="${fallbackUrl}" method="POST" record="record-from-answer-dual" recordingStatusCallback="${recordingStatusUrl}" recordingStatusCallbackMethod="POST">
    <Client>andre</Client>
  </Dial>
</Response>`;
  }

  return new NextResponse(twiml, {
    headers: { 'Content-Type': 'text/xml' },
  });
}

export async function GET() {
  const vmUrl = `${APP_URL}/api/voicemail`;
  if (!FORWARD_TO) {
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Redirect method="POST">${vmUrl}</Redirect>
</Response>`;
    return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } });
  }
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="${MYBIZ_NUMBER}" timeout="20" action="${vmUrl}" method="POST">
    <Number>${FORWARD_TO}</Number>
  </Dial>
</Response>`;
  return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } });
}
