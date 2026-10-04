import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

// Called by Twilio when recording is ready
export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const recordingUrl = formData.get('RecordingUrl') as string;
  const recordingSid = formData.get('RecordingSid') as string;
  const callerNumber = formData.get('From') as string;
  const duration = formData.get('RecordingDuration') as string;

  // 1. Fetch the audio and transcribe with Whisper
  let transcript = '';
  let aiSummary = null;

  try {
    const audioRes = await fetch(`${recordingUrl}.mp3`, {
      headers: {
        Authorization: `Basic ${Buffer.from(
          `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`
        ).toString('base64')}`,
      },
    });
    const audioBuffer = await audioRes.arrayBuffer();
    const audioFile = new File([audioBuffer], 'voicemail.mp3', { type: 'audio/mpeg' });

    const transcription = await openai.audio.transcriptions.create({
      file: audioFile,
      model: 'whisper-1',
    });
    transcript = transcription.text;

    // 2. AI extraction — name, request, urgency, callback time, suggested action
    const extraction = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are an assistant that extracts key information from voicemail transcripts for a real estate and contracting business. 
Return ONLY valid JSON with these fields:
{
  "caller_name": string or null,
  "callback_number": string or null,
  "request_summary": string (1-2 sentences max),
  "urgency": "high" | "medium" | "low",
  "time_mentions": string or null,
  "suggested_action": string (e.g. "Call back", "Send quote", "Schedule showing", "Follow up tomorrow")
}`,
        },
        {
          role: 'user',
          content: `Voicemail transcript:\n"${transcript}"`,
        },
      ],
    });

    const raw = extraction.choices[0].message.content || '{}';
    aiSummary = JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch (err) {
    console.error('Transcription/AI error:', err);
  }

  // 3. Store in Supabase
  await supabase.from('voicemails').insert({
    recording_sid: recordingSid,
    recording_url: `${recordingUrl}.mp3`,
    caller_number: callerNumber,
    duration_seconds: parseInt(duration || '0'),
    transcript,
    ai_summary: aiSummary,
    heard: false,
    created_at: new Date().toISOString(),
  });

  // 4. Send push notification
  try {
    const callerName = aiSummary?.caller_name || callerNumber;
    const summary = aiSummary?.request_summary || 'New voicemail received';
    await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: `📬 Voicemail from ${callerName}`,
        body: summary,
      }),
    });
  } catch {}

  return new NextResponse(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`, {
    headers: { 'Content-Type': 'text/xml' },
  });
}
