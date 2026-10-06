import { NextRequest, NextResponse } from 'next/server';

export function middleware(req: NextRequest) {
  // Skip API routes
  if (req.nextUrl.pathname.startsWith('/api')) return NextResponse.next();

  const session = req.cookies.get('mbl_session')?.value;
  const login = req.nextUrl.pathname === '/login';

  if (session) return NextResponse.next();
  if (login) return NextResponse.next();

  return NextResponse.redirect(new URL('/login', req.url));
}

export const config = { matcher: ['/((?!_next|favicon|icons|manifest).*)'] };
