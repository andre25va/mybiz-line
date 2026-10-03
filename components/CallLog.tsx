'use client';
import { useEffect, useState } from 'react';
import { Phone, PhoneIncoming, PhoneMissed } from 'lucide-react';

interface Call {
  sid: string; from: string; to: string;
  direction: string; status: string; duration: string; startTime: string;
}

function fmtDur(s: string) {
  const n = parseInt(s || '0');
  if (n < 60) return `${n}s`;
  return `${Math.floor(n/60)}m ${n%60}s`;
}

function fmtTime(t: string) {
  if (!t) return '';
  return new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

interface Props { myNumber: string; onCall: (n: string) => void; }

export default function CallLog({ myNumber, onCall }: Props) {
  const [calls, setCalls] = useState<Call[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/calls/history')
      .then(r => r.json())
      .then(d => { setCalls(Array.isArray(d) ? d : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-12 text-muted text-sm">Loading…</div>;
  if (!calls.length) return <div className="flex justify-center py-12 text-muted text-sm">No calls yet</div>;

  return (
    <div className="divide-y divide-border">
      {calls.map(c => {
        const isInbound = c.direction === 'inbound';
        const isMissed = c.status === 'no-answer' || c.status === 'busy' || c.status === 'failed';
        const contact = isInbound ? c.from : c.to;
        const Icon = isMissed ? PhoneMissed : isInbound ? PhoneIncoming : Phone;
        const iconColor = isMissed ? 'text-danger' : isInbound ? 'text-accent' : 'text-muted';

        return (
          <div key={c.sid} className="flex items-center gap-3 px-4 py-3 hover:bg-card transition-colors cursor-pointer" onClick={() => onCall(contact)}>
            <div className={`w-10 h-10 rounded-full bg-card border border-border flex items-center justify-center flex-shrink-0 ${iconColor}`}>
              <Icon size={18} />
            </div>
            <div className="flex-1 min-w-0">
              <div className={`font-medium text-sm truncate ${isMissed ? 'text-danger' : 'text-white'}`}>{contact}</div>
              <div className="text-muted text-xs">{fmtTime(c.startTime)} {c.duration && parseInt(c.duration) > 0 ? `· ${fmtDur(c.duration)}` : ''}</div>
            </div>
            <button onClick={e => { e.stopPropagation(); onCall(contact); }} className="p-2 text-muted hover:text-accent transition-colors">
              <Phone size={16} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
