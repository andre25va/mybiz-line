import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const { text } = await req.json();
  if (!text) return NextResponse.json({ detected: false });

  const OPENAI_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_KEY) return NextResponse.json({ detected: false });

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You extract appointment/meeting/event info from SMS messages. Today is ${today}.
Return JSON with these fields:
- detected: boolean (true only if there is a clear meeting, appointment, call, or scheduled event)
- title: string (short event title, e.g. "Meeting with John", "Call re: project")
- date: "YYYY-MM-DD" or null (resolve relative dates like "tomorrow", "next Monday")
- time: "HH:MM" in 24h or null (resolve "noon"=12:00, "midnight"=00:00; if am/pm ambiguous use 09:00)
- description: string (brief context from the message)
Only set detected=true for actual scheduled events, not vague references.`,
        },
        { role: 'user', content: text },
      ],
      max_tokens: 200,
    }),
  });

  if (!r.ok) return NextResponse.json({ detected: false });
  const data = await r.json();
  try {
    const result = JSON.parse(data.choices[0].message.content);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ detected: false });
  }
}
