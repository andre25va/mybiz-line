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
          content: `You extract scheduling intent from SMS messages. Today is ${today}.
Be LIBERAL — detect any message that suggests a meeting, call, appointment, or get-together, even if casual (e.g. "can we meet?", "let's talk Monday", "are you free Tuesday?", "lunch next week?", "call me at 3").
Return JSON with these fields:
- detected: boolean (true if there is ANY scheduling intent, proposed time, or meeting request)
- title: string (short event title, e.g. "Meeting", "Call", "Lunch" — infer from context)
- date: "YYYY-MM-DD" or null (resolve "this Monday", "tomorrow", "next week", etc. relative to today)
- time: "HH:MM" in 24h or null (resolve "1 PM"=13:00, "noon"=12:00; if unknown use null)
- description: string (the original message or brief summary)
When in doubt, set detected=true rather than missing a real scheduling request.`,
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
