import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { subscription } = body;
  if (!subscription?.endpoint) return NextResponse.json({ error: 'No subscription' }, { status: 400 });
  // In production wire to VAPID push service — for now acknowledge
  console.log('[Push] Subscription registered:', subscription.endpoint);
  return NextResponse.json({ ok: true });
}
