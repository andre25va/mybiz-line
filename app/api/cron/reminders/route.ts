import { NextRequest, NextResponse } from 'next/server';
import { sb, sendSms } from '@/lib/sb-rest';
import { sendEmail } from '@/lib/email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization');
  if (secret !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);

  // 1. Send SMS for pending reminders due now
  const reminderRes = await sb(
    `/scheduled_reminders?status=eq.pending&reminder_time=lte.${encodeURIComponent(now.toISOString())}&select=id,contact_phone,message`,
    { method: 'GET' }
  );
  const dueReminders: any[] = await reminderRes.json();
  let smsSent = 0;
  for (const row of dueReminders) {
    try {
      await sendSms(row.contact_phone, row.message);
      await sb(`/scheduled_reminders?id=eq.${row.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'sent' }),
      });
      smsSent++;
    } catch (err) {
      console.error('reminder SMS failed', row.id, err);
    }
  }

  // 2. Fetch today's reminders for digest
  const todayRemRes = await sb(
    `/scheduled_reminders?status=eq.pending&reminder_time=gte.${encodeURIComponent(todayStart.toISOString())}&reminder_time=lte.${encodeURIComponent(todayEnd.toISOString())}&select=contact_phone,message,reminder_time`,
    { method: 'GET' }
  );
  const todayReminders: any[] = await todayRemRes.json();

  // 3. Fetch tasks due today
  const tasksRes = await sb(
    `/biz_tasks?status=neq.done&due_date=gte.${todayStart.toISOString().split('T')[0]}&due_date=lte.${todayEnd.toISOString().split('T')[0]}&select=title,due_date,contact_id`,
    { method: 'GET' }
  );
  const tasks: any[] = await tasksRes.json();

  // 4. Fetch missed calls from yesterday
  const callsRes = await sb(
    `/call_recordings?created_at=gte.${encodeURIComponent(yesterdayStart.toISOString())}&created_at=lte.${encodeURIComponent(todayStart.toISOString())}&select=from_number,created_at`,
    { method: 'GET' }
  );
  const missedCalls: any[] = await callsRes.json();

  // 5. Build digest email
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/Chicago' });

  let html = `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#1f2937">
  <h2 style="color:#2563eb;border-bottom:2px solid #e5e7eb;padding-bottom:8px">📋 Daily Digest — ${dateStr}</h2>`;

  // Reminders section
  html += `<h3 style="color:#374151">🔔 Reminders Today (${todayReminders.length})</h3>`;
  if (todayReminders.length) {
    html += '<ul style="padding-left:20px">';
    for (const r of todayReminders) {
      const t = new Date(r.reminder_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' });
      html += `<li style="margin-bottom:8px"><strong>${r.contact_phone}</strong> at ${t}<br><span style="color:#6b7280">${r.message}</span></li>`;
    }
    html += '</ul>';
  } else {
    html += '<p style="color:#6b7280">No reminders scheduled for today.</p>';
  }

  // Tasks section
  html += `<h3 style="color:#374151">✅ Tasks Due Today (${tasks.length})</h3>`;
  if (tasks.length) {
    html += '<ul style="padding-left:20px">';
    for (const t of tasks) {
      html += `<li style="margin-bottom:8px">${t.title}</li>`;
    }
    html += '</ul>';
  } else {
    html += '<p style="color:#6b7280">No tasks due today.</p>';
  }

  // Missed calls section
  html += `<h3 style="color:#374151">📞 Missed Calls Yesterday (${missedCalls.length})</h3>`;
  if (missedCalls.length) {
    html += '<ul style="padding-left:20px">';
    for (const c of missedCalls) {
      html += `<li style="margin-bottom:8px">${c.from_number}</li>`;
    }
    html += '</ul>';
  } else {
    html += '<p style="color:#6b7280">No missed calls yesterday.</p>';
  }

  html += `<hr style="margin-top:24px;border-color:#e5e7eb">
  <p style="color:#9ca3af;font-size:12px">MyBiz Line daily digest — sent every morning at 8 AM CT</p>
</div>`;

  await sendEmail({
    to: process.env.ADMIN_EMAIL || 'tc@myredeal.com',
    subject: `MyBiz Line Daily Digest — ${dateStr}`,
    html,
  });

  return NextResponse.json({ smsSent, digestSent: true });
}
