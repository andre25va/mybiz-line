import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req: NextRequest) {
  try {
    const { messages, business, contactName } = await req.json();
    const name = contactName ? `The contact's name is ${contactName}.` : '';
    const system = `You are a helpful assistant drafting a short SMS reply for a ${business} business owner. ${name} Keep replies brief, professional, and friendly — 1-3 sentences max. Do not use emojis unless the conversation already has them.`;
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'system', content: system }, ...messages],
      max_tokens: 150,
    });
    return NextResponse.json({ reply: completion.choices[0].message.content?.trim() || '' });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
