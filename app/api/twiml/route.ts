import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const to = formData.get('To') as string;
  const callerId = process.env.TWILIO_PHONE_NUMBER!;

  let twiml: string;

  if (to) {
    // Outbound: dial the number
    twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="${callerId}" timeout="30">
    <Number>${to}</Number>
  </Dial>
</Response>`;
  } else {
    // Inbound: ring Andre's browser
    twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial timeout="30">
    <Client>andre</Client>
  </Dial>
</Response>`;
  }

  return new NextResponse(twiml, {
    headers: { 'Content-Type': 'text/xml' },
  });
}

// Also handle inbound from phone number voice URL
export async function GET() {
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial timeout="30">
    <Client>andre</Client>
  </Dial>
</Response>`;
  return new NextResponse(twiml, {
    headers: { 'Content-Type': 'text/xml' },
  });
}
