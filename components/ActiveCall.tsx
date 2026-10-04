'use client';
import { Mic, MicOff, PhoneOff, Grid3x3, FileText, Link2, NotebookPen, Bell, Clock } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import Dialpad from './Dialpad';

function fmt(s: number) {
  const m = Math.floor(s / 60).toString().padStart(2,'0');
  const sec = (s % 60).toString().padStart(2,'0');
  return `${m}:${sec}`;
}

interface SavedLink { name: string; url: string; }
interface Template { name: string; body: string; }

function getLinks(): SavedLink[] {
  try { return JSON.parse(localStorage.getItem('mybiz_links') || '[]'); } catch { return []; }
}
function getTemplates(): Template[] {
  try { return JSON.parse(localStorage.getItem('mybiz_templates') || '[]'); } catch { return []; }
}

const QUICK_FOLLOWUPS = [
  { label: 'Call back in 1 hour', minutes: 60 },
  { label: 'Call back in 3 hours', minutes: 180 },
  { label: 'Call back tomorrow', minutes: 60 * 24 },
  { label: 'Call back in 3 days', minutes: 60 * 24 * 3 },
  { label: 'Call back in 1 week', minutes: 60 * 24 * 7 },
];

interface Props {
  status: string; duration: number; number: string;
  muted: boolean; onHangup: () => void; onToggleMute: () => void; activeConn: any;
}

export default function ActiveCall({ status, duration, number, muted, onHangup, onToggleMute, activeConn }: Props) {
  const [showDialpad, setShowDialpad] = useState(false);
  const [panel, setPanel] = useState<null | 'transcript' | 'note' | 'template' | 'link' | 'followup'>(null);
  const [transcript, setTranscript] = useState('');
  const [listening, setListening] = useState(false);
  const [note, setNote] = useState('');
  const [noteSaved, setNoteSaved] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [links, setLinks] = useState<SavedLink[]>([]);
  const [smsSent, setSmsSent] = useState('');
  const [taskSaved, setTaskSaved] = useState('');
  const [customFollowup, setCustomFollowup] = useState('');
  const recognitionRef = useRef<any>(null);

  const label = status === 'connecting' ? 'Calling…' : status === 'ringing' ? 'Ringing…' : status === 'connected' ? fmt(duration) : status;

  useEffect(() => {
    setTemplates(getTemplates());
    setLinks(getLinks());
  }, []);

  function toggleTranscript() {
    if (panel === 'transcript') { stopListening(); setPanel(null); return; }
    setPanel('transcript');
    startListening();
  }

  function startListening() {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) { setTranscript(t => t + '\n[Speech recognition not supported on this browser]'); return; }
    const r = new SpeechRecognition();
    r.continuous = true;
    r.interimResults = true;
    r.lang = 'en-US';
    r.onresult = (e: any) => {
      let final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) final += e.results[i][0].transcript + ' ';
      }
      if (final) setTranscript(t => t + final);
    };
    r.start();
    recognitionRef.current = r;
    setListening(true);
  }

  function stopListening() {
    recognitionRef.current?.stop();
    setListening(false);
  }

  async function sendSMS(body: string) {
    try {
      await fetch('/api/sms/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: number, body }),
      });
      setSmsSent('Sent!');
      setTimeout(() => setSmsSent(''), 2000);
    } catch { setSmsSent('Failed'); setTimeout(() => setSmsSent(''), 2000); }
  }

  function saveNote() {
    if (!note.trim()) return;
    const key = `mybiz_note_${number}`;
    const existing = localStorage.getItem(key) || '';
    const ts = new Date().toLocaleString();
    localStorage.setItem(key, existing + `\n[${ts} - During call]\n${note}\n`);
    setNoteSaved(true);
    setTimeout(() => setNoteSaved(false), 2000);
  }

  function saveFollowupTask(label: string, minutes: number) {
    const due = new Date(Date.now() + minutes * 60 * 1000);
    const tasks = JSON.parse(localStorage.getItem('mybiz_tasks_local') || '[]');
    tasks.push({
      id: Date.now().toString(),
      title: `Follow up: ${label} with ${number}`,
      notes: `Call back reminder set during call on ${new Date().toLocaleString()}`,
      due_date: due.toISOString().split('T')[0],
      done: false,
      business: 'general',
      created_at: new Date().toISOString(),
    });
    localStorage.setItem('mybiz_tasks_local', JSON.stringify(tasks));
    setTaskSaved(label);
    setTimeout(() => setTaskSaved(''), 2500);
  }

  function saveCustomFollowup() {
    if (!customFollowup.trim()) return;
    const tasks = JSON.parse(localStorage.getItem('mybiz_tasks_local') || '[]');
    tasks.push({
      id: Date.now().toString(),
      title: `Follow up: ${customFollowup} with ${number}`,
      notes: `Custom reminder set during call on ${new Date().toLocaleString()}`,
      done: false,
      business: 'general',
      created_at: new Date().toISOString(),
    });
    localStorage.setItem('mybiz_tasks_local', JSON.stringify(tasks));
    setTaskSaved(customFollowup);
    setCustomFollowup('');
    setTimeout(() => setTaskSaved(''), 2500);
  }

  return (
    <div className="flex flex-col gap-4 py-6 bg-card rounded-3xl border border-border shadow-sm mx-4">
      {/* Header */}
      <div className="flex flex-col items-center gap-2">
        <div className="w-16 h-16 rounded-full bg-surface border border-border flex items-center justify-center text-2xl">📞</div>
        <div className="text-center">
          <div className="text-lg font-semibold text-text">{number}</div>
          <div className="text-accent text-sm font-medium">{label}</div>
        </div>
      </div>

      {/* Main call controls */}
      <div className="flex gap-5 items-center justify-center">
        <button onClick={onToggleMute} className={`w-14 h-14 rounded-full flex items-center justify-center border transition-all shadow-sm ${muted ? 'bg-text text-white border-text' : 'bg-surface border-border text-text'}`}>
          {muted ? <MicOff size={22} /> : <Mic size={22} />}
        </button>
        <button onClick={onHangup} className="w-16 h-16 rounded-full bg-red-600 hover:bg-red-700 flex items-center justify-center shadow-lg transition-all active:scale-95">
          <PhoneOff size={24} className="text-white" />
        </button>
        <button onClick={() => setShowDialpad(p => !p)} className={`w-14 h-14 rounded-full flex items-center justify-center border transition-all shadow-sm ${showDialpad ? 'bg-text text-white border-text' : 'bg-surface border-border text-text'}`}>
          <Grid3x3 size={22} />
        </button>
      </div>

      {showDialpad && status === 'connected' && (
        <div className="px-4"><Dialpad onCall={() => {}} disabled activeConn={activeConn} /></div>
      )}

      {/* Quick action buttons */}
      {status === 'connected' && (
        <div className="flex gap-2 justify-center px-4 flex-wrap">
          <button onClick={toggleTranscript} className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${panel === 'transcript' ? 'bg-blue-600 text-white border-blue-600' : 'bg-surface border-border text-text'}`}>
            <Mic size={13} /> {listening ? 'Stop' : 'Transcribe'}
          </button>
          <button onClick={() => setPanel(p => p === 'note' ? null : 'note')} className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${panel === 'note' ? 'bg-blue-600 text-white border-blue-600' : 'bg-surface border-border text-text'}`}>
            <NotebookPen size={13} /> Note
          </button>
          <button onClick={() => setPanel(p => p === 'template' ? null : 'template')} className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${panel === 'template' ? 'bg-blue-600 text-white border-blue-600' : 'bg-surface border-border text-text'}`}>
            <FileText size={13} /> Templates
          </button>
          <button onClick={() => setPanel(p => p === 'link' ? null : 'link')} className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${panel === 'link' ? 'bg-blue-600 text-white border-blue-600' : 'bg-surface border-border text-text'}`}>
            <Link2 size={13} /> Send Link
          </button>
          <button onClick={() => setPanel(p => p === 'followup' ? null : 'followup')} className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${panel === 'followup' ? 'bg-orange-500 text-white border-orange-500' : 'bg-surface border-border text-text'}`}>
            <Clock size={13} /> Follow Up
          </button>
        </div>
      )}

      {/* Transcript Panel */}
      {panel === 'transcript' && (
        <div className="mx-4 bg-surface rounded-2xl border border-border p-3 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-text">Live Transcript</span>
            {listening && <span className="text-xs text-red-500 animate-pulse">● Recording</span>}
          </div>
          <div className="text-xs text-subtext min-h-[60px] max-h-[120px] overflow-y-auto whitespace-pre-wrap">
            {transcript || 'Listening…'}
          </div>
          {transcript && (
            <button onClick={() => { navigator.clipboard.writeText(transcript); }} className="self-end text-xs text-blue-600">Copy</button>
          )}
        </div>
      )}

      {/* Note Panel */}
      {panel === 'note' && (
        <div className="mx-4 bg-surface rounded-2xl border border-border p-3 flex flex-col gap-2">
          <span className="text-xs font-semibold text-text">Quick Note</span>
          <textarea
            className="text-sm border border-border rounded-xl p-2 bg-white resize-none focus:outline-none focus:ring-1 focus:ring-blue-500"
            rows={3}
            placeholder="Type a note about this call…"
            value={note}
            onChange={e => setNote(e.target.value)}
          />
          <button onClick={saveNote} className="self-end bg-blue-600 text-white text-xs px-4 py-1.5 rounded-full font-medium">
            {noteSaved ? 'Saved ✓' : 'Save Note'}
          </button>
        </div>
      )}

      {/* Template Panel */}
      {panel === 'template' && (
        <div className="mx-4 bg-surface rounded-2xl border border-border p-3 flex flex-col gap-2 max-h-48 overflow-y-auto">
          <span className="text-xs font-semibold text-text">Send Template via SMS</span>
          {smsSent && <span className="text-xs text-green-600 font-medium">{smsSent}</span>}
          {templates.length === 0 && <span className="text-xs text-subtext">No templates saved yet. Add them in Settings.</span>}
          {templates.map((t, i) => (
            <button key={i} onClick={() => sendSMS(t.body)} className="text-left text-xs border border-border rounded-xl p-2 hover:bg-blue-50 transition-all">
              <div className="font-medium text-text">{t.name}</div>
              <div className="text-subtext truncate">{t.body}</div>
            </button>
          ))}
        </div>
      )}

      {/* Link Panel */}
      {panel === 'link' && (
        <div className="mx-4 bg-surface rounded-2xl border border-border p-3 flex flex-col gap-2 max-h-48 overflow-y-auto">
          <span className="text-xs font-semibold text-text">Send Link via SMS</span>
          {smsSent && <span className="text-xs text-green-600 font-medium">{smsSent}</span>}
          {links.length === 0 && <span className="text-xs text-subtext">No saved links yet. Add them in Settings.</span>}
          {links.map((l, i) => (
            <button key={i} onClick={() => sendSMS(`${l.name}: ${l.url}`)} className="text-left text-xs border border-border rounded-xl p-2 hover:bg-blue-50 transition-all">
              <div className="font-medium text-text">{l.name}</div>
              <div className="text-subtext truncate">{l.url}</div>
            </button>
          ))}
        </div>
      )}

      {/* Follow Up Panel */}
      {panel === 'followup' && (
        <div className="mx-4 bg-surface rounded-2xl border border-border p-3 flex flex-col gap-2">
          <span className="text-xs font-semibold text-text">⏰ Quick Follow-Up Reminder</span>
          {taskSaved && <span className="text-xs text-green-600 font-medium">✓ Task saved: {taskSaved}</span>}
          <div className="flex flex-col gap-1.5">
            {QUICK_FOLLOWUPS.map((f, i) => (
              <button
                key={i}
                onClick={() => saveFollowupTask(f.label, f.minutes)}
                className="text-left text-xs border border-border rounded-xl px-3 py-2 hover:bg-orange-50 hover:border-orange-300 transition-all flex items-center gap-2"
              >
                <Clock size={12} className="text-orange-500 shrink-0" />
                <span className="text-text font-medium">{f.label}</span>
              </button>
            ))}
          </div>
          <div className="flex gap-2 mt-1">
            <input
              className="flex-1 text-xs border border-border rounded-xl px-3 py-2 bg-white focus:outline-none focus:ring-1 focus:ring-orange-400"
              placeholder="Custom reminder (e.g. Call back Friday)"
              value={customFollowup}
              onChange={e => setCustomFollowup(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && saveCustomFollowup()}
            />
            <button
              onClick={saveCustomFollowup}
              className="bg-orange-500 text-white text-xs px-3 py-1.5 rounded-full font-medium"
            >
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
