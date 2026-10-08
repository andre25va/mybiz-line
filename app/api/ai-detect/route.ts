import { NextRequest, NextResponse } from 'next/server';
import { isDetectedEvent } from '@/lib/detect-event';

function errorResponse(status: number, code: string) {
  return NextResponse.json({ error: { code } }, { status });
}

export async function POST(req: NextRequest) {
  let requestBody: unknown;
  try {
    requestBody = await req.json();
  } catch {
    return errorResponse(400, 'invalid_request');
  }

  if (typeof requestBody !== 'object' || requestBody === null || Array.isArray(requestBody) ||
      typeof (requestBody as Record<string, unknown>).text !== 'string' ||
      !(requestBody as { text: string }).text.trim()) {
    return errorResponse(400, 'invalid_request');
  }
  const text = (requestBody as { text: string }).text.trim();

  const OPENAI_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_KEY) return errorResponse(503, 'not_configured');

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  try {
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

    if (!r.ok) return errorResponse(502, 'provider_error');

    const data: unknown = await r.json();
    if (typeof data !== 'object' || data === null || !('choices' in data) ||
        !Array.isArray(data.choices) || typeof data.choices[0] !== 'object' || data.choices[0] === null ||
        !('message' in data.choices[0]) || typeof data.choices[0].message !== 'object' ||
        data.choices[0].message === null || !('content' in data.choices[0].message) ||
        typeof data.choices[0].message.content !== 'string') {
      return errorResponse(502, 'invalid_provider_response');
    }

    let result: unknown;
    try {
      result = JSON.parse(data.choices[0].message.content);
    } catch {
      return errorResponse(502, 'invalid_provider_response');
    }

    if (!isDetectedEvent(result)) return errorResponse(502, 'invalid_provider_response');
    return NextResponse.json(result);
  } catch {
    return errorResponse(502, 'provider_error');
  }
}
