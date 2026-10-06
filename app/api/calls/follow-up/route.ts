import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-check';
import { sendSms } from '@/lib/sb-rest';

function bizName(business?: string): string {
  const b = (business || '').toLowerCase();
  if (b === 'myredeal' || b.includes('real estate')) return 'MyReDeal';
  if (b === 'contractors-kc' || b.includes('contractors')) return 'Contractors of KC';
  return 'us';
}

export async function POST(req: NextRequest) {
  const session = requireAuth(req);
  if (session instanceof NextResponse) return session;

  const { contactPhone, contactName, business, type } = await req.json();
  if (!contactPhone || !['missed-call', 'review-request'].includes(type)) {
    return NextResponse.json({ error: 'contactPhone and valid type required' }, { status: 400 });
  }
  const name = contactName && contactName !== contactPhone ? contactName : 'there';
  const body =
    type === 'missed-call'
      ? `Hi ${name}, sorry I missed your call! I'll get back to you shortly. - ${bizName(business)}`
      : `Hi ${name}, thanks for working with us! We'd love your feedback. Leave us a review: [review link]`;
  try {
    await sendSms(contactPhone, body);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
