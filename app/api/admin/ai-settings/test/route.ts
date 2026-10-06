import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-check';

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { provider, api_key, model } = await req.json();

  try {
    if (provider === 'openai') {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${api_key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: model || 'gpt-4o-mini', messages: [{ role: 'user', content: 'ping' }], max_tokens: 5 }),
      });
      if (!res.ok) { const e = await res.json(); return NextResponse.json({ error: e.error?.message || 'Invalid key' }, { status: 400 }); }
      return NextResponse.json({ ok: true });
    }

    if (provider === 'anthropic') {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': api_key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: model || 'claude-haiku-3-5', max_tokens: 5, messages: [{ role: 'user', content: 'ping' }] }),
      });
      if (!res.ok) { const e = await res.json(); return NextResponse.json({ error: e.error?.message || 'Invalid key' }, { status: 400 }); }
      return NextResponse.json({ ok: true });
    }

    if (provider === 'xai') {
      const res = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${api_key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: model || 'grok-2', messages: [{ role: 'user', content: 'ping' }], max_tokens: 5 }),
      });
      if (!res.ok) { const e = await res.json(); return NextResponse.json({ error: e.error?.message || 'Invalid key' }, { status: 400 }); }
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Unknown provider' }, { status: 400 });
  } catch {
    return NextResponse.json({ error: 'Connection failed' }, { status: 500 });
  }
}
