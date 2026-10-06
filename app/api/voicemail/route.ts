import { NextRequest, NextResponse } from 'next/server';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://mybiz-line-git-main-andre25vas-projects.vercel.app';

// Called by Twilio after dial action completes (no answer / busy)
export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const dialCallStatus = formData.get('DialCallStatus') as string;

  // If not answered, route to AI receptionist
  if (!dialCallStatus || dialCallStatus === 'no-answer' || dialCallStatus === 'busy' || dialCallStatus === 'failed') {
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <ConversationRelay url="wss://${APP_URL.replace(/^https?:\/\//, '')}/api/conversation-relay" welcomeGreeting="Hi, I missed your call but I'm here to help. How can I assist you today?"/>
  </Connect>
</Response>`;
    return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } });
  }

  // Call was answered — no voicemail needed
  return new NextResponse(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`, {
    headers: { 'Content-Type': 'text/xml' },
  });
}
