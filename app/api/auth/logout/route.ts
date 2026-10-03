import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const url = new URL('/login', req.url);
  const res = NextResponse.redirect(url);
  res.cookies.delete('mbl_auth');
  return res;
}
