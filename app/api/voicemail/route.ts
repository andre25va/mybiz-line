import { NextRequest, NextResponse } from 'next/server';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://mybiz-line-git-main-andre25vas-projects.vercel.app';

// Called by Twilio after dial action completes (no answer / busy)
export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const dialCallStatus = formData.get('DialCallStatus') as string;

  // If not answered, play greeting and record
  if (!dialCallStatus || dialCallStatus === 'no-answer' || dialCallStatus === 'busy' || dialCallStatus === 'failed') {
    const recordUrl = `${APP_URL}/api/voicemail/recording`;
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">Hi, you've reached MyBiz Line. Please leave your name, number, and a brief message and I'll get back to you as soon as possible. Press pound when finished.</Say>
  <Record action="${recordUrl}" method="POST" maxLength="120" finishOnKey="#" transcribe="false" playBeep="true"/>
  <Say>Thank you for your message. Goodbye.</Say>
</Response>`;
    return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } });
  }

  // Call was answered — no voicemail needed
  return new NextResponse(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`, {
    headers: { 'Content-Type': 'text/xml' },
  });
}
