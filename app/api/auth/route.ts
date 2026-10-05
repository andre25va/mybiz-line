import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const { password } = await req.json();
  const correct = process.env.APP_PASSWORD;

  if (!correct) {
    return NextResponse.json({ error: 'APP_PASSWORD not configured on server' }, { status: 500 });
  }

  if (password !== correct) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set('mbl_auth', correct, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30,
    path: '/',
  });
  return res;
}
