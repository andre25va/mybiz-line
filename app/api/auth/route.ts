import { NextResponse } from 'next/server';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete('mbl_session');
  res.cookies.delete('mbl_auth');
  return res;
}
