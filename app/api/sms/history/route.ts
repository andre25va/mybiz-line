import { NextRequest, NextResponse } from 'next/server';
import twilio from 'twilio';
import { businessNumber, fetchNumberMessages, messageTime, messagingServiceSids } from '@/lib/sms-traffic';

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID!,
  process.env.TWILIO_AUTH_TOKEN!
);

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const contact = searchParams.get('contact');

  try {
    const messages = await fetchNumberMessages(client, {
      contact,
      ourNumber: businessNumber(),
      serviceSids: messagingServiceSids(),
      limit: 50,
    });
    const ordered = messages.sort((a, b) => messageTime(a).getTime() - messageTime(b).getTime());

    const mapped = await Promise.all(ordered.map(async (m) => {
      let mediaUrls: string[] = [];
      if (m.numMedia && parseInt(String(m.numMedia)) > 0) {
        try {
          const mediaList = await client.messages(m.sid).media.list();
          mediaUrls = mediaList.map((med) =>
            `https://api.twilio.com${med.uri.replace('.json', '')}`
          );
        } catch {}
      }
      return {
        sid: m.sid,
        from: m.from,
        to: m.to,
        body: m.body,
        direction: m.direction,
        status: m.status,
        dateSent: messageTime(m).toISOString(),
        mediaUrls,
      };
    }));

    return NextResponse.json(mapped);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
