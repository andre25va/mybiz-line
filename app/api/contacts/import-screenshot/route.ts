// app/api/contacts/import-screenshot/route.ts
import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('image') as File;
    if (!file) return NextResponse.json({ error: 'No image' }, { status: 400 });

    const bytes = await file.arrayBuffer();
    const base64 = Buffer.from(bytes).toString('base64');
    const mimeType = file.type || 'image/jpeg';

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Extract contact information from this screenshot. Return ONLY a JSON object with these fields (use null for missing):
{
  "name": "full name or null",
  "phone": "phone number or null",
  "email": "email address or null",
  "address": "address or null",
  "notes": "any other relevant info or null"
}
No markdown, no explanation, just the JSON.`,
            },
            {
              type: 'image_url',
              image_url: { url: `data:${mimeType};base64,${base64}` },
            },
          ],
        },
      ],
      max_tokens: 300,
    });

    const text = response.choices[0]?.message?.content?.trim() || '{}';
    // Strip markdown fences if present
    const clean = text.replace(/^```json?\n?/, '').replace(/\n?```$/, '').trim();
    const extracted = JSON.parse(clean);

    return NextResponse.json({
      name: extracted.name || '',
      phone: extracted.phone || '',
      email: extracted.email || '',
      address: extracted.address || '',
      notes: extracted.notes || '',
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
