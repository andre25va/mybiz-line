import { NextResponse } from 'next/server';
export async function GET() {
  const res = NextResponse.redirect('/login');
  res.cookies.delete('mbl_auth');
  return res;
}
