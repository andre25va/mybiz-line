import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-check';
import { sb, sendSms } from '@/lib/sb-rest';

export async function POST(req: NextRequest) {
  const session = requireAuth(req);
  if (session instanceof NextResponse) return session;
  const { userId } = session;

  const { contactPhone, contactName, business, appointmentTime, reminderMessage, reminderMinutesBefore } = await req.json();
  const appt = new Date(appointmentTime);
  if (!contactPhone || isNaN(appt.getTime())) {
    return NextResponse.json({ error: 'contactPhone and valid appointmentTime required' }, { status: 400 });
  }
  const mins = Number.isFinite(Number(reminderMinutesBefore)) && reminderMinutesBefore !== undefined ? Number(reminderMinutesBefore) : 60;
  const sendAt = new Date(appt.getTime() - mins * 60000);
  const message =
    (typeof reminderMessage === 'string' && reminderMessage.trim()) ||
    `Hi ${contactName || 'there'}, this is a reminder about your appointment on ${appt.toLocaleString('en-US', { timeZone: 'America/Chicago', dateStyle: 'medium', timeStyle: 'short' })}.`;

  const immediate = sendAt.getTime() <= Date.now();
  try {
    const row = {
      user_id: userId,
      contact_phone: contactPhone,
      contact_name: contactName ?? null,
      business: business ?? null,
      appointment_time: appt.toISOString(),
      reminder_time: sendAt.toISOString(),
      message,
      status: 'pending',
    };
    if (!immediate) {
      await sb('/scheduled_reminders', { method: 'POST', body: JSON.stringify(row) });
      return NextResponse.json({ ok: true, scheduled: true, sendAt: sendAt.toISOString() });
    }
    await sendSms(contactPhone, message);
    try {
      await sb('/scheduled_reminders', { method: 'POST', body: JSON.stringify({ ...row, status: 'sent' }) });
    } catch (e) {
      console.error('reminder log failed', e);
    }
    return NextResponse.json({ ok: true, scheduled: false, sendAt: new Date().toISOString() });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to schedule reminder' }, { status: 500 });
  }
}
