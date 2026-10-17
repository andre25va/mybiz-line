import { NextResponse } from 'next/server';
import { supabaseRest } from '@/lib/supabase-server';

function sb(path: string, opts?: RequestInit) {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return supabaseRest(suffix, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(opts?.headers as Record<string, string> | undefined),
    },
  });
}

export async function GET() {
  try {
    const res = await sb('pending_vcards?select=*&order=created_at.desc&limit=10');
    if (!res.ok) return NextResponse.json([]);
    const data = await res.json();
    return NextResponse.json(Array.isArray(data) ? data : []);
  } catch {
    return NextResponse.json([]);
  }
}

export async function DELETE(req: Request) {
  try {
    const { id } = await req.json();
    if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 });
    await sb(`pending_vcards?id=eq.${id}`, { method: 'DELETE' });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
