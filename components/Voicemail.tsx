'use client';
import { useEffect, useState, useRef } from 'react';

interface AISummary {
  caller_name?: string | null;
  callback_number?: string | null;
  request_summary?: string | null;
  urgency?: 'high' | 'medium' | 'low' | null;
  time_mentions?: string | null;
  suggested_action?: string | null;
}

interface Voicemail {
  id: string;
  caller_number: string;
  duration_seconds: number;
  transcript: string;
  ai_summary: AISummary | null;
  heard: boolean;
  recording_url: string;
  created_at: string;
}

interface Props {
  contacts: { name: string; phone: string; business: string }[];
  activeBusiness: string;
  onCall: (number: string) => void;
  onSMS: (number: string) => void;
}

const BIZ_COLOR: Record<string, string> = {
  myredeal: 'bg-green-600',
  contractors: 'bg-orange-600',
  personal: 'bg-gray-700',
};

const URGENCY_COLOR: Record<string, string> = {
  high: 'bg-red-100 text-red-700 border-red-200',
  medium: 'bg-amber-100 text-amber-700 border-amber-200',
  low: 'bg-green-100 text-green-700 border-green-200',
};

function formatDuration(secs: number) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
}

export default function Voicemail({ contacts, activeBusiness, onCall, onSMS }: Props) {
  const [voicemails, setVoicemails] = useState<Voicemail[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const audioRefs = useRef<Record<string, HTMLAudioElement>>({});

  useEffect(() => {
    loadVoicemails();
    const iv = setInterval(loadVoicemails, 30000);
    return () => clearInterval(iv);
  }, []);

  async function loadVoicemails() {
    try {
      const res = await fetch('/api/voicemail/list');
      const data = await res.json();
      setVoicemails(data);
    } catch {}
    setLoading(false);
  }

  async function markHeard(id: string) {
    await fetch('/api/voicemail/list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action: 'heard' }),
    });
    setVoicemails(v => v.map(vm => vm.id === id ? { ...vm, heard: true } : vm));
  }

  async function deleteVoicemail(id: string) {
    await fetch('/api/voicemail/list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action: 'delete' }),
    });
    setVoicemails(v => v.filter(vm => vm.id !== id));
  }

  function togglePlay(vm: Voicemail) {
    const audio = audioRefs.current[vm.id];
    if (!audio) return;
    if (playing === vm.id) {
      audio.pause();
      setPlaying(null);
    } else {
      Object.values(audioRefs.current).forEach(a => a.pause());
      audio.play();
      setPlaying(vm.id);
      if (!vm.heard) markHeard(vm.id);
    }
  }

  function getContact(phone: string) {
    const clean = phone.replace(/\D/g, '');
    return contacts.find(c => c.phone.replace(/\D/g, '').endsWith(clean.slice(-10)));
  }

  const unheard = voicemails.filter(v => !v.heard).length;

  if (loading) return <div className="flex items-center justify-center h-40 text-gray-400">Loading voicemails…</div>;

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg font-semibold text-gray-800">Voicemail</span>
          {unheard > 0 && (
            <span className="bg-red-500 text-white text-xs font-bold rounded-full px-2 py-0.5">{unheard}</span>
          )}
        </div>
        <span className="text-xs text-gray-400">{voicemails.length} message{voicemails.length !== 1 ? 's' : ''}</span>
      </div>

      {voicemails.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 text-gray-400 gap-2">
          <span className="text-4xl">📬</span>
          <span className="text-sm">No voicemails yet</span>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
          {voicemails.map(vm => {
            const contact = getContact(vm.caller_number);
            const biz = contact?.business || 'personal';
            const name = contact?.name || vm.ai_summary?.caller_name || vm.caller_number;
            const isExpanded = expanded === vm.id;
            const isPlaying = playing === vm.id;
            const urgency = vm.ai_summary?.urgency || 'low';

            return (
              <div
                key={vm.id}
                className={`bg-white p-4 ${!vm.heard ? 'border-l-4 border-blue-500' : ''}`}
              >
                {/* Top row */}
                <div className="flex items-start gap-3">
                  {/* Avatar */}
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold text-sm flex-shrink-0 ${BIZ_COLOR[biz] || 'bg-gray-600'}`}>
                    {name.charAt(0).toUpperCase()}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`font-semibold text-sm ${!vm.heard ? 'text-gray-900' : 'text-gray-600'}`}>{name}</span>
                      {!vm.heard && <span className="w-2 h-2 bg-blue-500 rounded-full inline-block"/>}
                      {vm.ai_summary?.urgency === 'high' && (
                        <span className="text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded font-medium">Urgent</span>
                      )}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">{formatTime(vm.created_at)} · {formatDuration(vm.duration_seconds)}</div>

                    {/* AI summary */}
                    {vm.ai_summary?.request_summary && (
                      <p className="text-sm text-gray-700 mt-1 leading-snug">{vm.ai_summary.request_summary}</p>
                    )}

                    {/* Suggested action */}
                    {vm.ai_summary?.suggested_action && (
                      <span className={`inline-block text-xs px-2 py-0.5 rounded border mt-1 font-medium ${URGENCY_COLOR[urgency]}`}>
                        💡 {vm.ai_summary.suggested_action}
                      </span>
                    )}
                  </div>

                  {/* Play button */}
                  <button data-action="play-voicemail"
                    onClick={() => togglePlay(vm)}
                    className={`w-10 h-10 rounded-full flex items-center justify-center text-white flex-shrink-0 ${isPlaying ? 'bg-blue-600' : 'bg-gray-800'}`}
                  >
                    {isPlaying ? '⏸' : '▶'}
                  </button>
                  <audio
                    ref={el => { if (el) audioRefs.current[vm.id] = el; }}
                    src={vm.recording_url}
                    onEnded={() => setPlaying(null)}
                  />
                </div>

                {/* Action buttons */}
                <div className="flex gap-2 mt-3 ml-13 flex-wrap">
                  <button data-action="call-back"
                    onClick={() => onCall(vm.caller_number)}
                    className="flex items-center gap-1 text-xs bg-green-600 text-white px-3 py-1.5 rounded-full font-medium"
                  >
                    📞 Call Back
                  </button>
                  <button data-action="send-sms"
                    onClick={() => onSMS(vm.caller_number)}
                    className="flex items-center gap-1 text-xs bg-blue-600 text-white px-3 py-1.5 rounded-full font-medium"
                  >
                    💬 Text
                  </button>
                  <button data-action="toggle-transcript"
                    onClick={() => setExpanded(isExpanded ? null : vm.id)}
                    className="flex items-center gap-1 text-xs bg-gray-100 text-gray-700 px-3 py-1.5 rounded-full font-medium"
                  >
                    📝 {isExpanded ? 'Hide' : 'Transcript'}
                  </button>
                  <button data-action="delete-voicemail"
                    onClick={() => deleteVoicemail(vm.id)}
                    className="flex items-center gap-1 text-xs bg-red-50 text-red-600 px-3 py-1.5 rounded-full font-medium"
                  >
                    🗑 Delete
                  </button>
                </div>

                {/* Expanded transcript + AI details */}
                {isExpanded && (
                  <div className="mt-3 bg-gray-50 rounded-xl p-3 space-y-2">
                    {vm.ai_summary && (
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        {vm.ai_summary.caller_name && (
                          <div><span className="text-gray-400">Name:</span> <span className="text-gray-700 font-medium">{vm.ai_summary.caller_name}</span></div>
                        )}
                        {vm.ai_summary.callback_number && (
                          <div><span className="text-gray-400">Callback #:</span> <span className="text-gray-700 font-medium">{vm.ai_summary.callback_number}</span></div>
                        )}
                        {vm.ai_summary.time_mentions && (
                          <div><span className="text-gray-400">Time:</span> <span className="text-gray-700 font-medium">{vm.ai_summary.time_mentions}</span></div>
                        )}
                        {vm.ai_summary.urgency && (
                          <div><span className="text-gray-400">Urgency:</span> <span className="font-medium capitalize">{vm.ai_summary.urgency}</span></div>
                        )}
                      </div>
                    )}
                    {vm.transcript && (
                      <>
                        <div className="text-xs text-gray-400 font-medium uppercase tracking-wide">Full Transcript</div>
                        <p className="text-sm text-gray-700 leading-relaxed">{vm.transcript}</p>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
