'use client';
import { Mic, MicOff, PhoneOff } from 'lucide-react';
import { Grid3x3 } from 'lucide-react';
import { useState } from 'react';
import Dialpad from './Dialpad';

function fmt(s: number) {
  const m = Math.floor(s / 60).toString().padStart(2,'0');
  const sec = (s % 60).toString().padStart(2,'0');
  return `${m}:${sec}`;
}

interface Props {
  status: string; duration: number; number: string;
  muted: boolean; onHangup: () => void; onToggleMute: () => void; activeConn: any;
}

export default function ActiveCall({ status, duration, number, muted, onHangup, onToggleMute, activeConn }: Props) {
  const [showDialpad, setShowDialpad] = useState(false);
  const label = status === 'connecting' ? 'Calling…' : status === 'ringing' ? 'Ringing…' : status === 'connected' ? fmt(duration) : status;

  return (
    <div className="flex flex-col items-center gap-6 py-8 bg-card rounded-3xl border border-border shadow-sm mx-4">
      <div className="w-20 h-20 rounded-full bg-surface border border-border flex items-center justify-center text-3xl">📞</div>
      <div className="text-center">
        <div className="text-xl font-semibold text-text">{number}</div>
        <div className="text-accent text-sm mt-1 font-medium">{label}</div>
      </div>
      {showDialpad && status === 'connected' && (
        <div className="w-full px-4"><Dialpad onCall={() => {}} disabled activeConn={activeConn} /></div>
      )}
      <div className="flex gap-6 items-center">
        <button onClick={onToggleMute} className={`w-14 h-14 rounded-full flex items-center justify-center border transition-all shadow-sm ${muted ? 'bg-text text-white border-text' : 'bg-surface border-border text-text'}`}>
          {muted ? <MicOff size={22} /> : <Mic size={22} />}
        </button>
        <button onClick={onHangup} className="w-16 h-16 rounded-full bg-danger hover:bg-red-700 flex items-center justify-center shadow-lg shadow-red-100 transition-all active:scale-95">
          <PhoneOff size={24} className="text-white" />
        </button>
        <button onClick={() => setShowDialpad(p => !p)} className={`w-14 h-14 rounded-full flex items-center justify-center border transition-all shadow-sm ${showDialpad ? 'bg-text text-white border-text' : 'bg-surface border-border text-text'}`}>
          <Grid3x3 size={22} />
        </button>
      </div>
    </div>
  );
}
