import { NextRequest, NextResponse } from 'next/server';
import { sb, sendSms } from '@/lib/sb-rest';

// Vercel cron: runs every minute
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  // Verify cron secret
  const secret = req.headers.get('authorization');
  if (secret !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date().toISOString();

  // Fetch all pending reminders due now
  const res = await sb(`/scheduled_reminders?status=eq.pending&reminder_time=lte.${encodeURIComponent(now)}&select=id,contact_phone,message`, { method: 'GET' });
  const rows: any[] = await res.json();

  if (!rows.length) return NextResponse.json({ sent: 0 });

  let sent = 0;
  for (const row of rows) {
    try {
      await sendSms(row.contact_phone, row.message);
      await sb(`/scheduled_reminders?id=eq.${row.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'sent' }),
      });
      sent++;
    } catch (err) {
      console.error('reminder send failed', row.id, err);
    }
  }

  return NextResponse.json({ sent });
}
