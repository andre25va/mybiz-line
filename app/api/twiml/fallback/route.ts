import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Called by Twilio if the app (WebRTC client) didn't answer within 15s
// Now routes to AI Voice Receptionist instead of voicemail
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://mybiz-line-git-main-andre25vas-projects.vercel.app';

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const dialStatus = formData.get('DialCallStatus') as string;

  if (dialStatus !== 'completed') {
    // Route to AI receptionist
    const relayUrl = `${APP_URL}/api/conversation-relay`;
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Redirect method="POST">${relayUrl}</Redirect>
</Response>`;
    return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } });
  }

  return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
    headers: { 'Content-Type': 'text/xml' },
  });
}
