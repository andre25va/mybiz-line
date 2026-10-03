'use client';
import { useEffect, useState } from 'react';
import { Phone, PhoneIncoming, PhoneMissed } from 'lucide-react';

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const TZ_SHORT = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short', timeZone: TZ })
  .formatToParts(new Date()).find(p => p.type === 'timeZoneName')?.value ?? '';

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
  const d = new Date(t);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 86400000) {
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: TZ }) + ' ' + TZ_SHORT;
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: TZ }) +
    ', ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: TZ });
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

  if (loading) return <div className="flex justify-center py-12 text-gray-400 text-sm">Loading…</div>;
  if (!calls.length) return <div className="flex justify-center py-12 text-gray-400 text-sm">No calls yet</div>;

  return (
    <div className="divide-y divide-gray-100">
      {calls.map(c => {
        const isInbound = c.direction === 'inbound';
        const isMissed = c.status === 'no-answer' || c.status === 'busy' || c.status === 'failed';
        const contact = isInbound ? c.from : c.to;
        const Icon = isMissed ? PhoneMissed : isInbound ? PhoneIncoming : Phone;
        const iconColor = isMissed ? 'text-red-500' : isInbound ? 'text-green-600' : 'text-gray-500';

        return (
          <div key={c.sid} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors cursor-pointer bg-white" onClick={() => onCall(contact)}>
            <div className={`w-10 h-10 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center flex-shrink-0 ${iconColor}`}>
              <Icon size={18} />
            </div>
            <div className="flex-1 min-w-0">
              <div className={`font-semibold text-sm truncate ${isMissed ? 'text-red-500' : 'text-gray-900'}`}>{contact}</div>
              <div className="text-gray-400 text-xs mt-0.5">{fmtTime(c.startTime)}{c.duration && parseInt(c.duration) > 0 ? ` · ${fmtDur(c.duration)}` : ''}</div>
            </div>
            <button onClick={e => { e.stopPropagation(); onCall(contact); }} className="p-2 text-gray-400 hover:text-green-600 transition-colors">
              <Phone size={16} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
