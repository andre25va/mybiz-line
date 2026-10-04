import { NextRequest, NextResponse } from 'next/server';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://mybiz-line-git-main-andre25vas-projects.vercel.app';
const FORWARD_TO = '+13129989898';
const MYBIZ_NUMBER = '+14647333257';

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const to = formData.get('To') as string;
  const callerId = process.env.TWILIO_PHONE_NUMBER || MYBIZ_NUMBER;

  // If this is an inbound call (To is our Twilio number)
  const isInbound = to === callerId || to === MYBIZ_NUMBER;

  let twiml: string;

  if (!isInbound && to) {
    // Outbound: record the call, then dial the intended number
    const recordingStatusUrl = `${APP_URL}/api/calls/recording-status`;
    twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="${MYBIZ_NUMBER}" timeout="30" record="record-from-answer-dual" recordingStatusCallback="${recordingStatusUrl}" recordingStatusCallbackMethod="POST">
    <Number>${to}</Number>
  </Dial>
</Response>`;
  } else {
    // Inbound: forward to Andre's cell showing MyBiz Line number so he knows it's a business call
    const vmUrl = `${APP_URL}/api/voicemail`;
    const recordingStatusUrl = `${APP_URL}/api/calls/recording-status`;
    twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="${MYBIZ_NUMBER}" timeout="20" action="${vmUrl}" method="POST" record="record-from-answer-dual" recordingStatusCallback="${recordingStatusUrl}" recordingStatusCallbackMethod="POST">
    <Number>${FORWARD_TO}</Number>
  </Dial>
</Response>`;
  }

  return new NextResponse(twiml, {
    headers: { 'Content-Type': 'text/xml' },
  });
}

export async function GET() {
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
