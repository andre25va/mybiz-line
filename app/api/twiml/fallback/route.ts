import { NextRequest, NextResponse } from 'next/server';

// Called by Twilio if the app (WebRTC client) didn't answer within 15s
// Falls back to Andre's cell, then voicemail if still no answer
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://mybiz-line-git-main-andre25vas-projects.vercel.app';
const FORWARD_TO = '+13129989898';
const MYBIZ_NUMBER = '+14647333257';

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const dialStatus = formData.get('DialCallStatus') as string;

  // If app didn't answer, forward to cell
  if (dialStatus !== 'completed') {
    const vmUrl = `${APP_URL}/api/voicemail`;
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="${MYBIZ_NUMBER}" timeout="20" action="${vmUrl}" method="POST">
    <Number>${FORWARD_TO}</Number>
  </Dial>
</Response>`;
    return new NextResponse(twiml, {
      headers: { 'Content-Type': 'text/xml' },
    });
  }

  // Call was completed in app — nothing more to do
  return new NextResponse(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`, {
    headers: { 'Content-Type': 'text/xml' },
  });
}
