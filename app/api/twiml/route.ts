import { NextRequest, NextResponse } from 'next/server';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://mybiz-line-git-main-andre25vas-projects.vercel.app';

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const to = formData.get('To') as string;
  const callerId = process.env.TWILIO_PHONE_NUMBER!;

  let twiml: string;

  if (to) {
    // Outbound: record the call, then dial
    const recordingStatusUrl = `${APP_URL}/api/calls/recording-status`;
    twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="${callerId}" timeout="30" record="record-from-answer-dual" recordingStatusCallback="${recordingStatusUrl}" recordingStatusCallbackMethod="POST">
    <Number>${to}</Number>
  </Dial>
</Response>`;
  } else {
    // Inbound: ring Andre's browser, then fall to voicemail if no answer
    const vmUrl = `${APP_URL}/api/voicemail`;
    twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial timeout="20" action="${vmUrl}" method="POST" record="record-from-answer-dual" recordingStatusCallback="${APP_URL}/api/calls/recording-status" recordingStatusCallbackMethod="POST">
    <Client>andre</Client>
  </Dial>
</Response>`;
  }

  return new NextResponse(twiml, {
    headers: { 'Content-Type': 'text/xml' },
  });
}

export async function GET() {
  const vmUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://mybiz-line-git-main-andre25vas-projects.vercel.app'}/api/voicemail`;
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial timeout="20" action="${vmUrl}" method="POST">
    <Client>andre</Client>
  </Dial>
</Response>`;
  return new NextResponse(twiml, {
    headers: { 'Content-Type': 'text/xml' },
  });
}
