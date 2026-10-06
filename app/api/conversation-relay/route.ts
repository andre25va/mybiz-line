import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { getSystemPrompt, getSummaryPrompt } from '@/lib/receptionist-prompt';

export const dynamic = 'force-dynamic';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://mybiz-line-git-main-andre25vas-projects.vercel.app';
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;
const MYBIZ_NUMBER = process.env.TWILIO_PHONE_NUMBER || '+14647333257';
const OWNER_NUMBER = process.env.TWILIO_FALLBACK_NUMBER || '+13129989898';

const VOICE = 'Polly.Kendra-Neural';

interface ConversationMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

const activeCalls = new Map<string, {
  messages: ConversationMessage[];
  callerNumber: string;
  transcript: string[];
}>();

export async function POST(req: NextRequest) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const body = await req.text();
  const params = new URLSearchParams(body);

  const event = params.get('event') || '';
  const callSid = params.get('CallSid') || '';
  const callerNumber = params.get('From') || '';
  const speechResult = params.get('SpeechResult') || '';
  const confidence = parseFloat(params.get('Confidence') || '0');

  function escapeXml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  async function getAIResponse(sid: string, userMessage: string | null): Promise<string> {
    const session = activeCalls.get(sid);
    if (!session) return 'Thank you for calling, how can I help you today?';
    if (userMessage) session.messages.push({ role: 'user', content: userMessage });
    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: session.messages,
        max_tokens: 80,
        temperature: 0.6,
      });
      const response = completion.choices[0]?.message?.content || "I'm sorry, could you repeat that?";
      session.messages.push({ role: 'assistant', content: response });
      return response;
    } catch {
      return "I'm having a little trouble, but I'm still here. Could you please repeat that?";
    }
  }

  function twimlSpeak(text: string, hangup = false): NextResponse {
    const continueUrl = `${APP_URL}/api/conversation-relay`;
    const xml = hangup
      ? `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="${VOICE}" language="en-US">${escapeXml(text)}</Say><Hangup/></Response>`
      : `<?xml version="1.0" encoding="UTF-8"?><Response>
  <Gather input="speech" timeout="3" speechTimeout="auto" action="${continueUrl}" method="POST" actionOnEmptyResult="true">
    <Say voice="${VOICE}" language="en-US">${escapeXml(text)}</Say>
  </Gather>
  <Redirect method="POST">${continueUrl}?event=silence&amp;CallSid=${encodeURIComponent(callSid)}</Redirect>
</Response>`;
    return new NextResponse(xml, { headers: { 'Content-Type': 'text/xml' } });
  }

  async function handleCallEnd(sid: string) {
    const session = activeCalls.get(sid);
    if (!session || session.transcript.length === 0) return;
    const fullTranscript = session.transcript.join('\n');
    try {
      const summaryCompletion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: getSummaryPrompt() },
          { role: 'user', content: fullTranscript },
        ],
        max_tokens: 300,
        response_format: { type: 'json_object' },
      });
      const summary = JSON.parse(summaryCompletion.choices[0]?.message?.content || '{}');
      const urgencyEmoji = summary.urgency === 'high' ? '\uD83D\uDD34' : summary.urgency === 'medium' ? '\uD83D\uDFE1' : '\uD83D\uDFE2';
      const smsBody =
        `${urgencyEmoji} AI Receptionist call:\n` +
        `From: ${summary.callerName || session.callerNumber} (${session.callerNumber})\n` +
        `Reason: ${summary.reason || 'Not specified'}\n` +
        (summary.callbackTime ? `Best time: ${summary.callbackTime}\n` : '') +
        (summary.requests ? `Requests: ${summary.requests}` : '');

      const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
      await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ From: MYBIZ_NUMBER, To: OWNER_NUMBER, Body: smsBody }).toString(),
      });

      try {
        const { createClient } = await import('@supabase/supabase-js');
        const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
        await supabase.from('voicemails').insert({ caller_number: session.callerNumber, transcript: fullTranscript, ai_summary: summary, heard: false });
      } catch {}
    } catch (err) {
      console.error('AI summary failed:', err);
    }
  }

  if (event === 'complete' || event === 'hangup') {
    await handleCallEnd(callSid);
    activeCalls.delete(callSid);
    return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', { headers: { 'Content-Type': 'text/xml' } });
  }

  if (!activeCalls.has(callSid)) {
    activeCalls.set(callSid, {
      messages: [{ role: 'system', content: getSystemPrompt() }],
      callerNumber,
      transcript: [],
    });
    return twimlSpeak('Thank you for calling, how can I help you today?');
  }

  if (event === 'silence') {
    const reprompt = await getAIResponse(callSid, '[The caller was silent. Gently ask if they are still there in one sentence.]');
    return twimlSpeak(reprompt);
  }

  if (speechResult && confidence > 0.3) {
    const session = activeCalls.get(callSid)!;
    session.transcript.push(`Caller: ${speechResult}`);
    const aiResponse = await getAIResponse(callSid, speechResult);
    session.transcript.push(`AI: ${aiResponse}`);
    const shouldEnd = aiResponse.toLowerCase().includes('goodbye') || aiResponse.toLowerCase().includes('take care') || session.transcript.length > 40;
    return twimlSpeak(aiResponse, shouldEnd);
  }

  const retry = await getAIResponse(callSid, '[Audio was unclear. Politely ask the caller to repeat themselves in one sentence.]');
  return twimlSpeak(retry);
}
