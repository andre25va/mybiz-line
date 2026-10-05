import { NextRequest, NextResponse } from 'next/server';
import twilio from 'twilio';

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID!,
  process.env.TWILIO_AUTH_TOKEN!
);

/** Normalize any phone format to E.164 (+1XXXXXXXXXX for US numbers) */
function toE164(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return `+${digits}`;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const raw = searchParams.get('contact');
  if (!raw) return NextResponse.json([]);

  const contact = toE164(raw);
  const myNumber = process.env.TWILIO_PHONE_NUMBER!;

  try {
    // Query all 3 directions to catch bot-sent messages (which may not have from=myNumber)
    const [sentTo, receivedFrom, allTo] = await Promise.all([
      // Standard sent: from my number to contact
      client.messages.list({ from: myNumber, to: contact, limit: 50 }),
      // Standard received: from contact to my number
      client.messages.list({ from: contact, to: myNumber, limit: 50 }),
      // Bot-sent fallback: any message TO contact (catches messaging service SID sends)
      client.messages.list({ to: contact, limit: 50 }),
    ]);

    // Merge and deduplicate by SID
    const seen = new Set<string>();
    const all = [...sentTo, ...receivedFrom, ...allTo]
      .filter(m => {
        if (seen.has(m.sid)) return false;
        seen.add(m.sid);
        return true;
      })
      // Only keep messages involving our number or our contact
      .filter(m =>
        m.from === myNumber || m.to === myNumber ||
        m.from === contact || m.to === contact
      )
      .sort((a, b) => new Date(a.dateSent).getTime() - new Date(b.dateSent).getTime());

    // Fetch media URLs for messages that have media
    const mapped = await Promise.all(all.map(async m => {
      let mediaUrls: string[] = [];
      if (m.numMedia && parseInt(m.numMedia) > 0) {
        try {
          const mediaList = await client.messages(m.sid).media.list();
          mediaUrls = mediaList.map(med =>
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
        dateSent: m.dateSent,
        mediaUrls,
      };
    }));

    return NextResponse.json(mapped);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
