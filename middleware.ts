import { NextRequest, NextResponse } from 'next/server';

export function middleware(req: NextRequest) {
  // Skip API routes
  if (req.nextUrl.pathname.startsWith('/api')) return NextResponse.next();

  const auth = req.cookies.get('mbl_auth')?.value;
  const password = process.env.APP_PASSWORD || 'mybizline';

  if (auth === password) return NextResponse.next();

  const login = req.nextUrl.pathname === '/login';
  if (login) return NextResponse.next();

  return NextResponse.redirect(new URL('/login', req.url));
}

export const config = { matcher: ['/((?!_next|favicon|icons|manifest).*)'] };
