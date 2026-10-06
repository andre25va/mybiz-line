'use client';
import { Phone, PhoneOff, User, Bot } from 'lucide-react';
import { useState, useEffect } from 'react';

interface Contact {
  id: string; name: string; phone: string; email?: string;
  address?: string; notes?: string; business: string; tags?: string[];
}

interface Props {
  from: string;
  callSid?: string;
  onAccept: () => void;
  onReject: () => void;
  onSendToAI?: () => void;
  contacts?: Contact[];
}

const BIZ_COLOR: Record<string, string> = {
  myredeal: 'bg-green-600',
  contractors: 'bg-orange-500',
  personal: 'bg-gray-600',
};
const BIZ_LABEL: Record<string, string> = {
  myredeal: 'Real Estate',
  contractors: 'Contractors of KC',
  personal: 'Personal',
};

function normalizePhone(p: string) {
  return p.replace(/\D/g, '').replace(/^1/, '');
}

export default function IncomingCall({ from, callSid, onAccept, onReject, onSendToAI, contacts = [] }: Props) {
  const [showProfile, setShowProfile] = useState(false);
  const [cnamName, setCnamName] = useState<string | null>(null);
  const [cnamLoading, setCnamLoading] = useState(false);
  const [sendingToAI, setSendingToAI] = useState(false);

  const fromNorm = normalizePhone(from);
  const contact = contacts.find(c => normalizePhone(c.phone) === fromNorm);

  const bizColor = contact ? (BIZ_COLOR[contact.business] || 'bg-gray-600') : 'bg-gray-600';
  const bizLabel = contact ? (BIZ_LABEL[contact.business] || contact.business) : null;

  useEffect(() => {
    if (contact || !from) return;
    setCnamLoading(true);
    fetch(`/api/cnam?phone=${encodeURIComponent(from)}`)
      .then(r => r.json())
      .then(d => { setCnamName(d.name ?? null); })
      .catch(() => {})
      .finally(() => setCnamLoading(false));
  }, [from, contact]);

  async function handleSendToAI() {
    setSendingToAI(true);
    try {
      if (callSid) {
        await fetch('/api/calls/send-to-ai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callSid }),
        });
      }
      onSendToAI?.();
      onReject(); // dismiss the incoming call UI
    } catch {
      setSendingToAI(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-3xl p-8 w-80 flex flex-col items-center gap-4 shadow-2xl">

        {/* Avatar */}
        <div className={`w-20 h-20 rounded-full ${bizColor} flex items-center justify-center text-white text-3xl animate-pulse shadow-lg`}>
          {contact ? contact.name[0].toUpperCase() : '\uD83D\uDCF2'}
        </div>

        {/* Name / number */}
        <div className="text-center">
          <div className="text-text font-bold text-xl">
            {contact ? contact.name : (cnamName ?? from)}
          </div>
          {contact && <div className="text-subtext text-sm">{from}</div>}
          {!contact && cnamName && <div className="text-subtext text-sm">{from}</div>}
          {!contact && cnamLoading && (
            <div className="text-subtext text-xs mt-0.5 animate-pulse">Looking up caller…</div>
          )}
          {!contact && cnamName && (
            <div className="text-xs text-gray-400 mt-0.5">via carrier ID</div>
          )}
          <div className="text-subtext text-sm mt-0.5">Incoming call</div>
          {bizLabel && (
            <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-white text-xs font-medium ${bizColor}`}>
              {bizLabel}
            </span>
          )}
          {contact?.tags && contact.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 justify-center mt-1">
              {contact.tags.map(tag => (
                <span key={tag} className="text-[10px] bg-blue-50 text-blue-600 border border-blue-200 px-2 py-0.5 rounded-full">{tag}</span>
              ))}
            </div>
          )}
        </div>

        {/* View Profile */}
        {contact && (
          <button data-action="view-profile"
            onClick={() => setShowProfile(p => !p)}
            className="flex items-center gap-1 text-xs text-blue-600 font-medium underline"
          >
            <User size={12} /> {showProfile ? 'Hide Profile' : 'View Profile'}
          </button>
        )}

        {showProfile && contact && (
          <div className="w-full bg-surface rounded-2xl border border-border p-3 flex flex-col gap-1.5 text-left max-h-40 overflow-y-auto">
            {contact.email && <div className="text-xs text-subtext">\uD83D\uDCE7 {contact.email}</div>}
            {contact.address && <div className="text-xs text-subtext">\uD83D\uDCCD {contact.address}</div>}
            {contact.notes && <div className="text-xs text-subtext">\uD83D\uDCDD {contact.notes}</div>}
          </div>
        )}

        {!contact && !cnamLoading && (
          <div className="text-xs text-subtext text-center">
            {cnamName ? `Carrier ID: ${cnamName}` : 'Unknown caller — you can save them after the call'}
          </div>
        )}

        {/* Three action buttons */}
        <div className="flex gap-5 mt-2 items-end">
          {/* Decline */}
          <button data-action="reject-call" onClick={onReject}
            className="flex flex-col items-center gap-1">
            <div className="w-14 h-14 rounded-full bg-danger hover:bg-red-700 flex items-center justify-center transition-all shadow-lg shadow-red-100">
              <PhoneOff size={22} className="text-white" />
            </div>
            <span className="text-[10px] text-subtext">Decline</span>
          </button>

          {/* Send to AI — center, slightly larger */}
          <button data-action="send-to-ai" onClick={handleSendToAI} disabled={sendingToAI}
            className="flex flex-col items-center gap-1">
            <div className="w-16 h-16 rounded-full bg-blue-600 hover:bg-blue-700 flex items-center justify-center transition-all shadow-lg shadow-blue-100 disabled:opacity-60">
              {sendingToAI
                ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                : <Bot size={26} className="text-white" />}
            </div>
            <span className="text-[10px] text-subtext">Send to AI</span>
          </button>

          {/* Accept */}
          <button data-action="accept-call" onClick={onAccept}
            className="flex flex-col items-center gap-1">
            <div className="w-14 h-14 rounded-full bg-accent hover:bg-green-700 flex items-center justify-center transition-all shadow-lg shadow-green-100">
              <Phone size={22} className="text-white" />
            </div>
            <span className="text-[10px] text-subtext">Answer</span>
          </button>
        </div>
      </div>
    </div>
  );
}
