import { NextRequest, NextResponse } from 'next/server';

// Proxy Twilio media so images display without CORS/auth issues
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const url = searchParams.get('url');
  if (!url) return NextResponse.json({ error: 'missing url' }, { status: 400 });

  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const token = process.env.TWILIO_AUTH_TOKEN!;
  const auth = Buffer.from(`${sid}:${token}`).toString('base64');

  const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
  const blob = await res.arrayBuffer();
  const contentType = res.headers.get('content-type') || 'image/jpeg';

  return new NextResponse(blob, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
