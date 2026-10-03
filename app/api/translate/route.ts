import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req: NextRequest) {
  try {
    const { text, targetLang } = await req.json();
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: `Translate the following text to ${targetLang}. Return only the translation, nothing else.` },
        { role: 'user', content: text },
      ],
      max_tokens: 300,
    });
    return NextResponse.json({ translation: completion.choices[0].message.content?.trim() || '' });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
