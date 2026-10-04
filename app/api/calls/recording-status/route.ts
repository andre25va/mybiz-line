import { NextRequest, NextResponse } from 'next/server';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const OPENAI_KEY = process.env.OPENAI_API_KEY!;

// Twilio calls this when a call recording is ready
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const recordingSid = formData.get('RecordingSid') as string;
    const recordingUrl = formData.get('RecordingUrl') as string;
    const callSid = formData.get('CallSid') as string;
    const duration = parseInt(formData.get('RecordingDuration') as string || '0');

    if (!recordingSid || !recordingUrl) {
      return new NextResponse('ok', { status: 200 });
    }

    // Download audio from Twilio
    const audioUrl = `${recordingUrl}.mp3`;
    const authHeader = 'Basic ' + Buffer.from(
      `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`
    ).toString('base64');

    const audioRes = await fetch(audioUrl, { headers: { Authorization: authHeader } });
    if (!audioRes.ok) {
      console.error('Failed to fetch recording', audioRes.status);
      return new NextResponse('ok', { status: 200 });
    }

    const audioBuffer = await audioRes.arrayBuffer();
    const audioBlob = new Blob([audioBuffer], { type: 'audio/mpeg' });

    // Transcribe with Whisper
    const formDataWhisper = new FormData();
    formDataWhisper.append('file', audioBlob, 'recording.mp3');
    formDataWhisper.append('model', 'whisper-1');
    formDataWhisper.append('language', 'en');

    const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_KEY}` },
      body: formDataWhisper,
    });

    let transcript = '';
    if (whisperRes.ok) {
      const whisperData = await whisperRes.json();
      transcript = whisperData.text || '';
    }

    // AI extraction — pull out action items, key details, follow-ups
    let aiSummary = null;
    if (transcript && transcript.length > 10) {
      const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{
            role: 'system',
            content: 'You are a business call assistant. Extract structured info from this call transcript. Return JSON only.',
          }, {
            role: 'user',
            content: `Extract from this call transcript:\n\n"${transcript}"\n\nReturn JSON:\n{\n  "summary": "1-2 sentence summary",\n  "action_items": ["list of action items"],\n  "key_details": ["key facts mentioned"],\n  "follow_up_needed": true/false,\n  "urgency": "high|medium|low"\n}`,
          }],
          response_format: { type: 'json_object' },
        }),
      });
      if (aiRes.ok) {
        const aiData = await aiRes.json();
        try { aiSummary = JSON.parse(aiData.choices[0].message.content); } catch {}
      }
    }

    // Save to Supabase call_recordings table
    await fetch(`${SUPABASE_URL}/rest/v1/call_recordings`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        recording_sid: recordingSid,
        recording_url: audioUrl,
        call_sid: callSid,
        duration_seconds: duration,
        transcript,
        ai_summary: aiSummary,
      }),
    });

    return new NextResponse('ok', { status: 200 });
  } catch (err) {
    console.error('recording-status error', err);
    return new NextResponse('ok', { status: 200 });
  }
}
